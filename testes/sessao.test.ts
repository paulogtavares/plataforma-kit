import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rotasAutenticacao } from "../src/autenticacao.js";
import { ErroApi } from "../src/erros.js";
import { assinarTokenPlataforma } from "../src/portal.js";
import { criarSessao, lerCookie } from "../src/sessao.js";
import { bancoComUsuarios } from "./apoio.js";

const TODAS = ["mod.ver", "mod.editar"] as const;
const SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres";
type Banco = Awaited<ReturnType<typeof bancoComUsuarios>>;

/** App mínima: rotas do kit + uma rota protegida que devolve o usuário. */
async function montar(banco: Banco, modo: "local" | "portal") {
  const sessao = criarSessao({
    banco,
    todasPermissoes: TODAS,
    modo,
    nomeCookie: "mod_sessao",
    modulo: "mod",
    segredoPlataforma: SEGREDO,
  });
  const app = Fastify();
  app.setErrorHandler((e: any, _req, reply) =>
    reply.code(e instanceof ErroApi ? e.status : e.name === "ZodError" ? 400 : 500).send({ erro: e.message }),
  );
  await app.register(rotasAutenticacao, { sessao, banco, producao: false });
  app.get("/api/protegida", async (req) => sessao.autenticar(req));
  await app.ready();
  return app;
}

describe("lerCookie", () => {
  it("acha o cookie certo entre vários e aguenta valor malformado", () => {
    expect(lerCookie({ headers: { cookie: "a=1; mod_sessao=abc%20d; b=2" } }, "mod_sessao")).toBe("abc d");
    expect(lerCookie({ headers: { cookie: "mod_sessao=%E0%A4%A" } }, "mod_sessao")).toBeNull();
    expect(lerCookie({ headers: {} }, "x")).toBeNull();
  });
});

describe("modo local", () => {
  let banco: Banco;
  let app: FastifyInstance;
  beforeAll(async () => {
    banco = await bancoComUsuarios();
    app = await montar(banco, "local");
  });
  afterAll(async () => {
    await app.close();
    await banco.fechar();
  });
  const entrar = (email: string, senha = "Senha123") =>
    app.inject({ method: "POST", url: "/api/auth/entrar", payload: { email, senha } });

  it("entra, grava o cookie com o nome do módulo e reconhece a sessão", async () => {
    const r = await entrar("BETO@x.com");
    expect(r.statusCode).toBe(200);
    expect(r.headers["set-cookie"]).toMatch(/^mod_sessao=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=/);
    const cookie = String(r.headers["set-cookie"]).split(";")[0];
    const eu = await app.inject({ method: "GET", url: "/api/protegida", headers: { cookie } });
    expect(eu.json()).toMatchObject({ email: "beto@x.com", permissoes: ["mod.ver"], administrador: false });
  });
  it("administrador recebe o catálogo inteiro", async () => {
    const cookie = String((await entrar("ana@x.com")).headers["set-cookie"]).split(";")[0];
    expect((await app.inject({ method: "GET", url: "/api/eu", headers: { cookie } })).json().permissoes).toEqual([
      "mod.ver",
      "mod.editar",
    ]);
  });
  it("recusa senha errada e usuário inativo com a mesma mensagem", async () => {
    expect((await entrar("beto@x.com", "errada")).json().erro).toBe("E-mail ou senha incorretos.");
    expect((await entrar("caio@x.com")).json().erro).toBe("E-mail ou senha incorretos.");
  });
  it("ignora x-usuario-id e x-plataforma-token no modo local", async () => {
    const id = (await banco.query("SELECT id FROM usuarios WHERE email = 'ana@x.com'")).rows[0].id;
    const token = await assinarTokenPlataforma(
      {
        iss: "portal",
        aud: "mod",
        sub: id,
        email: "ana@x.com",
        tipo: "interno",
        permissoes: [],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      SEGREDO,
    );
    const r = await app.inject({
      method: "GET",
      url: "/api/protegida",
      headers: { "x-usuario-id": id, "x-plataforma-token": token },
    });
    expect(r.statusCode).toBe(401);
  });
  it("sessão expirada e troca de senha pendente", async () => {
    const cookie = String((await entrar("beto@x.com")).headers["set-cookie"]).split(";")[0];
    await banco.query("UPDATE usuarios SET precisa_trocar_senha = true WHERE email = 'beto@x.com'");
    expect((await app.inject({ method: "GET", url: "/api/protegida", headers: { cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/eu", headers: { cookie } })).statusCode).toBe(200);
    const troca = await app.inject({
      method: "POST",
      url: "/api/auth/trocar-senha",
      headers: { cookie },
      payload: { senha_atual: "Senha123", nova_senha: "NovaSenha9" },
    });
    expect(troca.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/protegida", headers: { cookie } })).statusCode).toBe(200);
    await banco.query("UPDATE sessoes SET expira_em = now() - interval '1 minute'");
    expect((await app.inject({ method: "GET", url: "/api/protegida", headers: { cookie } })).json().erro).toMatch(
      /expirou/,
    );
  });
  it("renova a sessão perto do vencimento (sessão deslizante)", async () => {
    const cookie = String((await entrar("ana@x.com")).headers["set-cookie"]).split(";")[0];
    await banco.query("UPDATE sessoes SET expira_em = now() + interval '1 day'");
    await app.inject({ method: "GET", url: "/api/protegida", headers: { cookie } });
    const { rows } = await banco.query("SELECT (expira_em > now() + interval '6 days') AS renovada FROM sessoes");
    expect(rows.every((x: any) => x.renovada)).toBe(true);
  });
});

describe("modo portal (contrato da plataforma)", () => {
  let banco: Banco;
  let app: FastifyInstance;
  const SUB_NOVO = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  const token = (d: Record<string, unknown>) =>
    assinarTokenPlataforma(
      {
        iss: "portal",
        aud: "mod",
        sub: SUB_NOVO,
        email: "nova@x.com",
        tipo: "interno",
        permissoes: ["mod.ver"],
        exp: Math.floor(Date.now() / 1000) + 300,
        ...d,
      } as any,
      SEGREDO,
    );
  const comToken = async (d: Record<string, unknown> = {}) =>
    app.inject({ method: "GET", url: "/api/protegida", headers: { "x-plataforma-token": await token(d) } });
  beforeAll(async () => {
    banco = await bancoComUsuarios();
    app = await montar(banco, "portal");
  });
  afterAll(async () => {
    await app.close();
    await banco.fechar();
  });

  it("primeiro acesso cria o usuário local pelo sub; permissões vêm do token, filtradas pelo catálogo", async () => {
    const r = await comToken({ nome: "Nova Pessoa", permissoes: ["mod.ver", "outro.modulo", "mod.inexistente"] });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      id: SUB_NOVO,
      nome: "Nova Pessoa",
      email: "nova@x.com",
      permissoes: ["mod.ver"],
      precisa_trocar_senha: false,
    });
    expect((await banco.query("SELECT count(*)::int AS n FROM usuarios WHERE id = $1", [SUB_NOVO])).rows[0].n).toBe(1);
  });
  it("acessos seguintes atualizam nome e e-mail; admin só para interno", async () => {
    expect((await comToken({ nome: "Nome Novo", admin: true })).json()).toMatchObject({
      nome: "Nome Novo",
      administrador: true,
      permissoes: ["mod.ver", "mod.editar"],
    });
    expect((await comToken({ tipo: "externo", admin: true })).json()).toMatchObject({
      tipo: "externo",
      administrador: false,
    });
  });
  it("usuário desativado no módulo continua bloqueado", async () => {
    await banco.query("UPDATE usuarios SET ativo = false WHERE id = $1", [SUB_NOVO]);
    expect((await comToken()).statusCode).toBe(403);
    await banco.query("UPDATE usuarios SET ativo = true WHERE id = $1", [SUB_NOVO]);
  });
  it("e-mail já usado por outro usuário local: 409 com mensagem clara", async () => {
    const r = await comToken({ sub: "11111111-2222-4333-8444-555555555555", email: "beto@x.com" });
    expect(r.statusCode).toBe(409);
    expect(r.json().erro).toMatch(/já está cadastrado/);
  });
  it("sem token, token de outro módulo ou inválido: 401; login por senha desligado", async () => {
    expect((await app.inject({ method: "GET", url: "/api/protegida" })).statusCode).toBe(401);
    expect((await comToken({ aud: "outro" })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: "/api/protegida", headers: { "x-plataforma-token": "abc" } })).statusCode,
    ).toBe(401);
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/entrar",
      payload: { email: "beto@x.com", senha: "Senha123" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toMatch(/pelo portal/);
  });
  it("exige segredo e id do módulo ao criar a sessão em modo portal", () => {
    expect(() => criarSessao({ banco, todasPermissoes: TODAS, modo: "portal", modulo: "mod" })).toThrow(
      /SEGREDO_PLATAFORMA/,
    );
    expect(() => criarSessao({ banco, todasPermissoes: TODAS, modo: "portal", segredoPlataforma: SEGREDO })).toThrow(
      /id do módulo/,
    );
  });
});
