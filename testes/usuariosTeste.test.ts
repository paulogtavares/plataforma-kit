import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditarUsuariosDeTeste } from "../src/usuariosTeste.js";
import { gerarHashSenha } from "../src/seguranca.js";
import { bancoComUsuarios } from "./apoio.js";

let banco: Awaited<ReturnType<typeof bancoComUsuarios>>;
beforeAll(async () => {
  banco = await bancoComUsuarios(); // ana, beto (senha "Senha123") e caio (inativo)
  await banco.query("UPDATE usuarios SET senha_hash = $1 WHERE email = 'beto@x.com'", [
    await gerarHashSenha("TrocadaPeloUsuario1"),
  ]);
  await banco.query(
    "INSERT INTO sessoes (token_hash, usuario_id, expira_em) SELECT 'h', id, now() + interval '1 day' FROM usuarios WHERE email = 'ana@x.com'",
  );
});
afterAll(() => banco.fechar());
const emails = ["ana@x.com", "beto@x.com", "caio@x.com"];

describe("usuários de teste herdados de bancos antigos", () => {
  it("fora de produção: só avisa quem ainda entra com a senha de teste", async () => {
    const log: string[] = [];
    expect(
      await auditarUsuariosDeTeste({ banco, emails, senha: "Senha123", producao: false, log: (m) => log.push(m) }),
    ).toEqual(["ana@x.com"]);
    expect(log[0]).toMatch(/ATENÇÃO.*ana@x.com/);
    expect(
      (await banco.query("SELECT senha_hash FROM usuarios WHERE email = 'ana@x.com'")).rows[0].senha_hash,
    ).not.toBeNull();
  });
  it("em produção: apaga a senha e encerra as sessões; quem trocou a senha não é afetado", async () => {
    const log: string[] = [];
    expect(
      await auditarUsuariosDeTeste({ banco, emails, senha: "Senha123", producao: true, log: (m) => log.push(m) }),
    ).toEqual(["ana@x.com"]);
    expect(log[0]).toMatch(/BLOQUEADOS/);
    const r = await banco.query("SELECT email, senha_hash IS NULL AS sem_senha FROM usuarios ORDER BY email");
    expect(r.rows).toEqual([
      { email: "ana@x.com", sem_senha: true },
      { email: "beto@x.com", sem_senha: false },
      { email: "caio@x.com", sem_senha: false },
    ]);
    expect((await banco.query("SELECT count(*)::int AS n FROM sessoes")).rows[0].n).toBe(0);
  });
  it("sem ninguém com a senha de teste: não faz nada", async () => {
    const log: string[] = [];
    expect(
      await auditarUsuariosDeTeste({ banco, emails, senha: "Senha123", producao: true, log: (m) => log.push(m) }),
    ).toEqual([]);
    expect(log).toEqual([]);
  });
});
