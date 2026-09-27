import { describe, expect, it } from "vitest";
import { bancoEmNuvem, lerAcesso, lerAmbiente } from "../src/ambiente.js";

const O = { modulo: "cronogramas", cookiePadrao: "cronogramas_sessao", nomesAntigosDados: ["CRONOGRAMA_DADOS"] };
const SEGREDO = "x".repeat(32);

describe("modo de teste (ajuste de segurança)", () => {
  it("só com MODO_TESTE=1, e nunca em nuvem: lá a variável é ignorada com erro no log", () => {
    expect(lerAmbiente(O, {}).modoTeste).toBe(false);
    expect(lerAmbiente(O, { MODO_TESTE: "1" })).toMatchObject({ modoTeste: true, erros: [] });
    expect(lerAmbiente(O, { MODO_TESTE: "true" }).avisos[0]).toMatch(/ignorado: use MODO_TESTE=1/);
    for (const [env, onde] of [
      [{ NODE_ENV: "production" }, "NODE_ENV=production"],
      [{ RAILWAY_ENVIRONMENT_NAME: "staging" }, "Railway"],
      [{ DATABASE_URL: "postgres://u:s@db.railway.internal:5432/x" }, "DATABASE_URL de nuvem"],
    ] as const) {
      const a = lerAmbiente(O, { MODO_TESTE: "1", ...env });
      expect(a.modoTeste).toBe(false);
      expect(a.erros[0]).toContain(`IGNORADO (${onde})`);
    }
  });
  it("banco local não conta como nuvem", () => {
    expect(bancoEmNuvem("postgres://app:app@localhost:5432/c")).toBe(false);
    expect(bancoEmNuvem("postgres://app:app@127.0.0.1/c")).toBe(false);
    expect(bancoEmNuvem("postgres://x@10.0.0.5/c")).toBe(true);
    expect(bancoEmNuvem("não é url")).toBe(true);
    expect(lerAmbiente(O, { MODO_TESTE: "1", DATABASE_URL: "postgres://app:app@localhost:5432/c" }).modoTeste).toBe(
      true,
    );
  });
  it("ambiente informado como producao ou local (nunca 'teste')", () => {
    expect(lerAmbiente(O, {}).ambiente).toBe("local");
    expect(lerAmbiente(O, { MODO_TESTE: "1" }).ambiente).toBe("local");
    expect(lerAmbiente(O, { NODE_ENV: "production" }).ambiente).toBe("producao");
  });
});

describe("escuta, pasta de dados e login", () => {
  it("127.0.0.1 no computador; 0.0.0.0 em nuvem; HOST manda", () => {
    expect(lerAmbiente(O, {}).host).toBe("127.0.0.1");
    expect(lerAmbiente(O, { RAILWAY_ENVIRONMENT: "x" }).host).toBe("0.0.0.0");
    expect(lerAmbiente(O, { NODE_ENV: "production", HOST: "127.0.0.1" }).host).toBe("127.0.0.1");
  });
  it("DADOS_DIR, com o nome antigo do módulo aceito por uma versão", () => {
    expect(lerAmbiente(O, { DADOS_DIR: "/d" })).toMatchObject({ dadosDir: "/d", avisos: [] });
    expect(lerAmbiente(O, { CRONOGRAMA_DADOS: "/v" })).toMatchObject({
      dadosDir: "/v",
      avisos: [expect.stringMatching(/obsoleta/)],
    });
    expect(lerAmbiente(O, { DADOS_DIR: "/n", CRONOGRAMA_DADOS: "/v" })).toMatchObject({
      dadosDir: "/n",
      avisos: [expect.stringMatching(/ignorada/)],
    });
  });
  it("AUTH_MODO, COOKIE_SESSAO e SEGREDO_PLATAFORMA", () => {
    expect(lerAcesso(O, {})).toEqual({ modo: "local", nomeCookie: "cronogramas_sessao", modulo: "cronogramas" });
    expect(lerAcesso(O, { AUTH_MODO: "Portal", SEGREDO_PLATAFORMA: SEGREDO })).toMatchObject({
      modo: "portal",
      segredoPlataforma: SEGREDO,
    });
    expect(() => lerAcesso(O, { AUTH_MODO: "sso" })).toThrow(/inválido/);
    expect(() => lerAcesso(O, { AUTH_MODO: "portal" })).toThrow(/SEGREDO_PLATAFORMA/);
    expect(() => lerAcesso(O, { COOKIE_SESSAO: "a; Domain=x" })).toThrow(/COOKIE_SESSAO/);
  });
});
