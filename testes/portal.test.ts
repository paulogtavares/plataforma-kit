import { describe, expect, it } from "vitest";
import { assinarTokenPortal, validarSegredo, verificarTokenPortal } from "../src/portal.js";

const SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres";
const agora = Date.UTC(2026, 8, 26, 12, 0, 0);
const s = Math.floor(agora / 1000);
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

describe("token do portal", () => {
  it("aceita token válido e normaliza o e-mail", async () => {
    const t = await assinarTokenPortal({ email: " Ana@Empresa.com ", exp: s + 300, iat: s, iss: "portal" }, SEGREDO);
    const d = await verificarTokenPortal(t, { segredo: SEGREDO, emissor: "portal" }, agora);
    expect(d.email).toBe("ana@empresa.com");
  });
  it("recusa expirado (com folga de 60 s) e emitido no futuro", async () => {
    const velho = await assinarTokenPortal({ email: "a@b.c", exp: s - 61 }, SEGREDO);
    await expect(verificarTokenPortal(velho, { segredo: SEGREDO }, agora)).rejects.toMatchObject({ status: 401, motivo: "expirado" });
    const dentroDaFolga = await assinarTokenPortal({ email: "a@b.c", exp: s - 30 }, SEGREDO);
    await expect(verificarTokenPortal(dentroDaFolga, { segredo: SEGREDO }, agora)).resolves.toBeTruthy();
    const futuro = await assinarTokenPortal({ email: "a@b.c", exp: s + 900, iat: s + 600 }, SEGREDO);
    await expect(verificarTokenPortal(futuro, { segredo: SEGREDO }, agora)).rejects.toMatchObject({ motivo: "emitido no futuro" });
  });
  it("recusa assinatura errada, segredo errado e conteúdo alterado", async () => {
    const t = await assinarTokenPortal({ email: "a@b.c", exp: s + 300 }, SEGREDO);
    await expect(verificarTokenPortal(t, { segredo: SEGREDO + "x" }, agora)).rejects.toMatchObject({ motivo: "assinatura" });
    const [c, , a] = t.split(".");
    const alterado = `${c}.${b64({ email: "admin@b.c", exp: s + 300 })}.${a}`;
    await expect(verificarTokenPortal(alterado, { segredo: SEGREDO }, agora)).rejects.toMatchObject({ motivo: "assinatura" });
  });
  it('recusa alg "none" e outros algoritmos', async () => {
    const semAssinatura = `${b64({ alg: "none", typ: "JWT" })}.${b64({ email: "a@b.c", exp: s + 300 })}.`;
    await expect(verificarTokenPortal(semAssinatura, { segredo: SEGREDO }, agora)).rejects.toMatchObject({ motivo: "algoritmo none" });
    const rs = `${b64({ alg: "RS256" })}.${b64({ email: "a@b.c", exp: s + 300 })}.xx`;
    await expect(verificarTokenPortal(rs, { segredo: SEGREDO }, agora)).rejects.toMatchObject({ motivo: "algoritmo RS256" });
  });
  it("recusa emissor diferente, sem e-mail e formato inválido", async () => {
    const t = await assinarTokenPortal({ email: "a@b.c", exp: s + 300, iss: "outro" }, SEGREDO);
    await expect(verificarTokenPortal(t, { segredo: SEGREDO, emissor: "portal" }, agora)).rejects.toMatchObject({ motivo: "emissor" });
    const semEmail = await assinarTokenPortal({ email: "", exp: s + 300 }, SEGREDO);
    await expect(verificarTokenPortal(semEmail, { segredo: SEGREDO }, agora)).rejects.toMatchObject({ motivo: "sem e-mail" });
    await expect(verificarTokenPortal("abc", { segredo: SEGREDO }, agora)).rejects.toMatchObject({ motivo: "formato" });
    await expect(verificarTokenPortal("a.b!.c", { segredo: SEGREDO }, agora)).rejects.toMatchObject({ motivo: "codificação" });
  });
  it("a mensagem para a tela não revela o motivo", async () => {
    await expect(verificarTokenPortal("abc", { segredo: SEGREDO }, agora)).rejects.toThrow("Acesso pelo portal inválido ou expirado. Entre novamente pelo portal.");
  });
  it("exige segredo com 32+ caracteres", () => {
    expect(() => validarSegredo("curto")).toThrow(/32 caracteres/);
    expect(validarSegredo(SEGREDO)).toBe(SEGREDO);
  });
});
