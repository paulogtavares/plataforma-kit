import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rotasAdministracao } from "../src/administracao.js";
import { prepararServidor } from "../src/servidor.js";
import { criarSessao } from "../src/sessao.js";
import { bancoComUsuarios } from "./apoio.js";

const CATALOGO = [
  { chave: "mod.ver", grupo: "Geral", nome: "Ver", descricao: "d" },
  { chave: "mod.interna", grupo: "Geral", nome: "Ver itens internos", descricao: "d" },
] as const;
let banco: Awaited<ReturnType<typeof bancoComUsuarios>>;
let app: FastifyInstance;
const cookies: Record<string, string> = {};

beforeAll(async () => {
  banco = await bancoComUsuarios(); // ana (admin), beto, caio (inativo); perfil "Equipe" = {mod.ver}
  await banco.query("UPDATE perfis SET permissoes = '{mod.ver,mod.interna}'");
  const sessao = criarSessao({ banco, todasPermissoes: CATALOGO.map((p) => p.chave), nomeCookie: "s" });
  app = Fastify();
  await prepararServidor(app, { sessao, banco, producao: false, versao: "t", data: "t", tipoBanco: () => "x", permissoes: CATALOGO, log: () => {} });
  await app.register(rotasAdministracao, { banco, catalogo: CATALOGO, permissaoInterna: "mod.interna" });
  await app.ready();
  for (const quem of ["ana", "beto"]) {
    const r = await app.inject({ method: "POST", url: "/api/auth/entrar", payload: { email: `${quem}@x.com`, senha: "Senha123" } });
    cookies[quem] = String(r.headers["set-cookie"]).split(";")[0];
  }
});
afterAll(async () => {
  await app.close();
  await banco.fechar();
});
const como = (quem: string, method: any, url: string, payload?: unknown) =>
  app.inject({ method, url, headers: { cookie: cookies[quem] }, ...(payload === undefined ? {} : { payload: payload as any }) });

describe("rotas de administração", () => {
  it("só administrador acessa", async () => {
    expect((await como("beto", "GET", "/api/admin/usuarios")).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/admin/perfis" })).statusCode).toBe(401);
    expect((await como("ana", "GET", "/api/admin/permissoes")).json()).toEqual(CATALOGO);
  });

  it("perfis: cria validando o catálogo, lista com a quantidade de usuários e não exclui em uso", async () => {
    expect((await como("ana", "POST", "/api/admin/perfis", { nome: "X", permissoes: ["outro.modulo"] })).json().erro).toBe("Permissão desconhecida: outro.modulo");
    const r = await como("ana", "POST", "/api/admin/perfis", { nome: "Cliente", descricao: "Externo", permissoes: ["mod.ver", "mod.ver"] });
    expect(r.statusCode).toBe(201);
    const perfis = (await como("ana", "GET", "/api/admin/perfis")).json();
    expect(perfis.map((p: any) => [p.nome, p.permissoes, p.qtd_usuarios])).toEqual([["Cliente", ["mod.ver"], 0], ["Equipe", ["mod.ver", "mod.interna"], 2]]);
    expect((await como("ana", "DELETE", `/api/admin/perfis/${perfis[1].id}`)).json().erro).toMatch(/em uso por 3 usuário/);
    expect((await como("ana", "DELETE", `/api/admin/perfis/${r.json().id}`)).statusCode).toBe(204);
  });

  it("usuários: cria com senha provisória (troca obrigatória) e tipo pelo perfil", async () => {
    const equipe = (await como("ana", "GET", "/api/admin/perfis")).json()[0];
    const r = await como("ana", "POST", "/api/admin/usuarios", { nome: "Dora", email: "DORA@x.com", perfil_id: equipe.id });
    expect(r.statusCode).toBe(201);
    expect(r.json().senha_provisoria).toMatch(/^.{8,}$/);
    const login = await app.inject({ method: "POST", url: "/api/auth/entrar", payload: { email: "dora@x.com", senha: r.json().senha_provisoria } });
    expect(login.json()).toMatchObject({ email: "dora@x.com", tipo: "interno", precisa_trocar_senha: true });
    const lista = (await como("ana", "GET", "/api/admin/usuarios")).json();
    expect(lista.find((u: any) => u.email === "dora@x.com")).toMatchObject({ perfil_nome: "Equipe", tem_senha: true, ativo: true });
  });

  it("perfil sem a permissão interna vira externo; administrador externo é recusado com o nome da permissão", async () => {
    const ext = (await como("ana", "POST", "/api/admin/perfis", { nome: "Externo", permissoes: ["mod.ver"] })).json().id;
    const r = await como("ana", "POST", "/api/admin/usuarios", { nome: "Eva", email: "eva@x.com", perfil_id: ext, administrador: true });
    expect(r.json().erro).toBe("Administradores precisam de um perfil com a permissão “Ver itens internos”.");
    const u = await como("ana", "POST", "/api/admin/usuarios", { nome: "Eva", email: "eva@x.com", perfil_id: ext });
    expect((await banco.query("SELECT tipo FROM usuarios WHERE id = $1", [u.json().id])).rows[0].tipo).toBe("externo");
  });

  it("tirar a permissão interna de um perfil com administrador é recusado", async () => {
    const equipe = (await como("ana", "GET", "/api/admin/perfis")).json().find((p: any) => p.nome === "Equipe");
    const r = await como("ana", "PUT", `/api/admin/perfis/${equipe.id}`, { nome: "Equipe", permissoes: ["mod.ver"] });
    expect(r.json().erro).toMatch(/^Ana é administrador\(a\) e usa este perfil\./);
  });

  it("editar e desativar: desativar derruba as sessões; ninguém remove o próprio acesso", async () => {
    const beto = (await banco.query("SELECT id FROM usuarios WHERE email = 'beto@x.com'")).rows[0].id;
    expect((await como("ana", "PATCH", `/api/admin/usuarios/${beto}`, { nome: "Beto Silva" })).json()).toEqual({ ok: true });
    expect((await como("beto", "GET", "/api/eu")).json().nome).toBe("Beto Silva");
    await como("ana", "PATCH", `/api/admin/usuarios/${beto}`, { ativo: false });
    expect((await como("beto", "GET", "/api/eu")).statusCode).toBe(401);
    const ana = (await banco.query("SELECT id FROM usuarios WHERE email = 'ana@x.com'")).rows[0].id;
    expect((await como("ana", "PATCH", `/api/admin/usuarios/${ana}`, { administrador: false })).json().erro).toMatch(/próprio acesso/);
    expect((await como("ana", "PATCH", `/api/admin/usuarios/${ana}`, {})).json().erro).toBe("Nada para alterar.");
    expect((await como("ana", "PATCH", `/api/admin/usuarios/${ana}`, { senha_hash: "x" })).statusCode).toBe(400);
  });

  it("redefinir senha: nova provisória, troca obrigatória e sessões encerradas", async () => {
    const caio = (await banco.query("SELECT id FROM usuarios WHERE email = 'caio@x.com'")).rows[0].id;
    await banco.query("UPDATE usuarios SET ativo = true WHERE id = $1", [caio]);
    const r = await como("ana", "POST", `/api/admin/usuarios/${caio}/redefinir-senha`);
    const login = await app.inject({ method: "POST", url: "/api/auth/entrar", payload: { email: "caio@x.com", senha: r.json().senha_provisoria } });
    expect(login.json().precisa_trocar_senha).toBe(true);
    expect((await como("ana", "POST", "/api/admin/usuarios/00000000-0000-4000-8000-000000000000/redefinir-senha")).statusCode).toBe(404);
  });
});

describe("sem permissão interna configurada", () => {
  it("todos são internos", async () => {
    const b = await bancoComUsuarios();
    const sessao = criarSessao({ banco: b, todasPermissoes: ["mod.ver"], nomeCookie: "s" });
    const a = Fastify();
    await prepararServidor(a, { sessao, banco: b, producao: false, versao: "t", data: "t", tipoBanco: () => "x", permissoes: [], log: () => {} });
    await a.register(rotasAdministracao, { banco: b, catalogo: [CATALOGO[0]] });
    await a.ready();
    const ck = String((await a.inject({ method: "POST", url: "/api/auth/entrar", payload: { email: "ana@x.com", senha: "Senha123" } })).headers["set-cookie"]).split(";")[0];
    const perfil = (await b.query("SELECT id FROM perfis LIMIT 1")).rows[0].id;
    const r = await a.inject({ method: "POST", url: "/api/admin/usuarios", headers: { cookie: ck }, payload: { nome: "F", email: "f@x.com", perfil_id: perfil, administrador: true } });
    expect(r.statusCode).toBe(201);
    await a.close();
    await b.fechar();
  });
  it("recusa permissão interna fora do catálogo", async () => {
    await expect(rotasAdministracao(Fastify(), { banco: {} as any, catalogo: CATALOGO, permissaoInterna: "nao.existe" })).rejects.toThrow(/não está no catálogo/);
  });
});
