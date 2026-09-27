import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { ErroApi } from "../src/erros.js";
import {
  aplicarPrefixo,
  normalizarPrefixo,
  prefixoDaRequisicao,
  prepararServidor,
  servirFront,
} from "../src/servidor.js";
import { criarSessao } from "../src/sessao.js";
import { bancoComUsuarios } from "./apoio.js";

describe("prefixo", () => {
  it("normaliza e recusa valores perigosos", () => {
    expect(normalizarPrefixo("/cronogramas")).toBe("/cronogramas/");
    expect(normalizarPrefixo('/x"><script>')).toBe("/");
    expect(normalizarPrefixo("/a/../b")).toBe("/");
    expect(prefixoDaRequisicao("/portal, /interno", undefined)).toBe("/portal/");
    expect(prefixoDaRequisicao(undefined, "/outro")).toBe("/outro/");
    expect(aplicarPrefixo('<head><base href="/" /></head>', "/c/")).toBe('<head><base href="/c/" /></head>');
  });
});

describe("prepararServidor e servirFront", () => {
  let banco: Awaited<ReturnType<typeof bancoComUsuarios>>;
  let app: FastifyInstance;
  beforeAll(async () => {
    banco = await bancoComUsuarios();
    const sessao = criarSessao({ banco, todasPermissoes: ["mod.ver"], nomeCookie: "mod_sessao" });
    app = Fastify();
    await prepararServidor(app, {
      sessao,
      banco,
      producao: false,
      versao: "9.9.9",
      data: "2026-09-26",
      tipoBanco: () => "embutido",
      permissoes: [{ chave: "mod.ver", grupo: "g", nome: "n", descricao: "d" }],
      manifesto: { id: "mod" },
      restricoes: { ck_x: "Regra X." },
      log: () => {},
    });
    app.get("/api/protegida", async () => ({ ok: true }));
    app.get("/api/erro/:tipo", { config: { publica: true } }, async (req: any) => {
      if (req.params.tipo === "api") throw new ErroApi(409, "Conflito.");
      if (req.params.tipo === "zod") z.object({ a: z.string({ required_error: "Informe a." }) }).parse({});
      if (req.params.tipo === "pg") throw Object.assign(new Error("x"), { code: "23514", constraint: "ck_x" });
      throw new Error("falha interna");
    });
    const pasta = mkdtempSync(join(tmpdir(), "kit-"));
    mkdirSync(join(pasta, "public", "assets"), { recursive: true });
    writeFileSync(join(pasta, "public", "index.html"), '<html><head><base href="/" /></head></html>');
    writeFileSync(join(pasta, "public", "assets", "a.js"), "1");
    servirFront(app, pasta);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await banco.fechar();
  });

  it("cabeçalhos de segurança: iframe só do mesmo domínio", async () => {
    const r = await app.inject({ method: "GET", url: "/api/saude" });
    expect(r.headers).toMatchObject({
      "x-frame-options": "SAMEORIGIN",
      "content-security-policy": "frame-ancestors 'self'",
      "x-content-type-options": "nosniff",
    });
  });
  it("/api/status: ambiente local, modo de teste desligado, sem senha de teste", async () => {
    const s = (await app.inject({ method: "GET", url: "/api/status" })).json();
    expect(s).toMatchObject({
      version: "9.9.9",
      ambiente: "local",
      modo_teste: false,
      autenticacao: "local",
      banco: "embutido",
      sem_administrador: false,
    });
    expect(s.acesso_teste).toBeUndefined();
  });
  it("/modulo.json com versão e catálogo; rotas /api protegidas", async () => {
    expect((await app.inject({ method: "GET", url: "/modulo.json" })).json()).toMatchObject({
      id: "mod",
      versao: "9.9.9",
      permissoes: [{ chave: "mod.ver" }],
    });
    expect((await app.inject({ method: "GET", url: "/api/protegida" })).statusCode).toBe(401);
  });
  it("erros no formato { erro, codigo }", async () => {
    const api = (await app.inject({ method: "GET", url: "/api/erro/api" })).json();
    expect(api).toMatchObject({ erro: "Conflito." });
    expect(api.codigo).toMatch(/^[0-9A-F]{4}$/);
    expect((await app.inject({ method: "GET", url: "/api/erro/zod" })).json().erro).toBe("Informe a.");
    expect((await app.inject({ method: "GET", url: "/api/erro/pg" })).json().erro).toBe("Regra X.");
    const r = await app.inject({ method: "GET", url: "/api/erro/outro" });
    expect(r.statusCode).toBe(500);
    expect(r.json().erro).toContain(r.json().codigo);
  });
  it("front: index.html com o prefixo do proxy, ativos com cache longo, endereço malformado recusado", async () => {
    expect(
      (await app.inject({ method: "GET", url: "/qualquer", headers: { "x-forwarded-prefix": "/mod" } })).body,
    ).toContain('<base href="/mod/" />');
    expect((await app.inject({ method: "GET", url: "/assets/a.js" })).headers["cache-control"]).toMatch(/immutable/);
    expect((await app.inject({ method: "GET", url: "/%E0%A4%A" })).statusCode).toBe(400);
  });
});
