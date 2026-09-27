import { describe, expect, it } from "vitest";
import {
  assinarTokenPlataforma,
  validarSegredo,
  verificarTokenPlataforma,
  type DeclaracoesPlataforma,
} from "../src/portal.js";

const SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres";
const agora = Date.UTC(2026, 8, 26, 12, 0, 0);
const s = Math.floor(agora / 1000);
const SUB = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const base = (extra: Partial<DeclaracoesPlataforma> = {}): DeclaracoesPlataforma => ({
  iss: "portal",
  aud: "cronogramas",
  sub: SUB,
  email: "ana@empresa.com",
  tipo: "interno",
  permissoes: ["cronogramas.criar"],
  exp: s + 300,
  ...extra,
});
const verificar = async (d: DeclaracoesPlataforma, segredo = SEGREDO) =>
  verificarTokenPlataforma(
    await assinarTokenPlataforma(d, segredo),
    { segredo: SEGREDO, modulo: "cronogramas" },
    agora,
  );

describe("token da plataforma (contrato do portal)", () => {
  it("aceita token válido, normaliza e-mail e completa nome, cliente e admin", async () => {
    const t = await verificar(base({ email: " Ana@Empresa.com ", aud: ["orc", "cronogramas"] }));
    expect(t).toMatchObject({ email: "ana@empresa.com", nome: "ana", cliente_id: null, admin: false, sub: SUB });
    expect((await verificar(base({ nome: "  Ana Souza ", admin: true }))).nome).toBe("Ana Souza");
  });
  it("aud: token de outro módulo é recusado", async () => {
    await expect(verificar(base({ aud: "orc" }))).rejects.toMatchObject({ status: 401, motivo: "destino orc" });
  });
  it("iss precisa ser portal", async () => {
    await expect(verificar(base({ iss: "outro" }))).rejects.toMatchObject({ motivo: "emissor outro" });
  });
  it("campos obrigatórios: sub (uuid), email, tipo, permissoes; cliente_id uuid quando vier", async () => {
    await expect(verificar(base({ sub: "123" }))).rejects.toMatchObject({ motivo: "sub" });
    await expect(verificar(base({ email: "sem-arroba" }))).rejects.toMatchObject({ motivo: "email" });
    await expect(verificar(base({ tipo: "admin" as any }))).rejects.toMatchObject({ motivo: "tipo" });
    await expect(verificar(base({ permissoes: "x" as any }))).rejects.toMatchObject({ motivo: "permissoes" });
    await expect(verificar(base({ cliente_id: "abc" }))).rejects.toMatchObject({ motivo: "cliente_id" });
  });
  it("validade: expirado (folga de 30 s) e emitido no futuro", async () => {
    await expect(verificar(base({ exp: s - 31 }))).rejects.toMatchObject({ motivo: "expirado" });
    await expect(verificar(base({ exp: s - 20 }))).resolves.toBeTruthy();
    await expect(verificar(base({ iat: s + 120 }))).rejects.toMatchObject({ motivo: "emitido no futuro" });
  });
  it("assinatura, segredo e conteúdo alterado", async () => {
    await expect(verificar(base(), SEGREDO + "x")).rejects.toMatchObject({ motivo: "assinatura" });
    const [c, , a] = (await assinarTokenPlataforma(base(), SEGREDO)).split(".");
    const alterado = `${c}.${b64({ ...base(), permissoes: ["cronogramas.tudo"] })}.${a}`;
    await expect(
      verificarTokenPlataforma(alterado, { segredo: SEGREDO, modulo: "cronogramas" }, agora),
    ).rejects.toMatchObject({ motivo: "assinatura" });
  });
  it('recusa alg "none", outros algoritmos e formato inválido, sem revelar o motivo na tela', async () => {
    const o = { segredo: SEGREDO, modulo: "cronogramas" };
    await expect(verificarTokenPlataforma(`${b64({ alg: "none" })}.${b64(base())}.`, o, agora)).rejects.toMatchObject({
      motivo: "algoritmo none",
    });
    await expect(verificarTokenPlataforma("abc", o, agora)).rejects.toThrow(
      "Acesso pelo portal inválido ou expirado. Entre novamente pelo portal.",
    );
    await expect(verificarTokenPlataforma("a.b!.c", o, agora)).rejects.toMatchObject({ motivo: "codificação" });
  });
  it("SEGREDO_PLATAFORMA com 32+ caracteres", () => {
    expect(() => validarSegredo("curto")).toThrow(/SEGREDO_PLATAFORMA/);
    expect(validarSegredo(SEGREDO)).toBe(SEGREDO);
  });
});
