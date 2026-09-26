import { describe, expect, it } from "vitest";
import { chaveDoModulo, criarCatalogo, exigirAdministrador, pode, prefixar } from "../src/permissoes.js";

describe("regra de nomes", () => {
  it("chave = <módulo>.<segmentos> em minúsculas", () => {
    expect(chaveDoModulo("cronogramas", "cronogramas.criar")).toBe(true);
    expect(chaveDoModulo("cronogramas", "cronogramas.modelos.gerenciar")).toBe(true);
    expect(chaveDoModulo("cronogramas", "modelos.ver")).toBe(false); // sem prefixo
    expect(chaveDoModulo("cronogramas", "orcamentos.ver")).toBe(false); // outro módulo
    expect(chaveDoModulo("cronogramas", "cronogramas")).toBe(false); // sem ação
    expect(chaveDoModulo("cronogramas", "cronogramas.Ver")).toBe(false);
    expect(chaveDoModulo("cronogramas", "cronogramas..ver")).toBe(false);
  });
  it("prefixar é idempotente", () => {
    expect(prefixar("cronogramas", "modelos.ver")).toBe("cronogramas.modelos.ver");
    expect(prefixar("cronogramas", "cronogramas.criar")).toBe("cronogramas.criar");
    expect(prefixar("cronogramas", prefixar("cronogramas", "visao.interna"))).toBe("cronogramas.visao.interna");
  });
});

describe("catálogo", () => {
  const item = (chave: string) => ({ chave, grupo: "g", nome: "n", descricao: "d" });
  it("monta a lista e valida chaves", () => {
    const c = criarCatalogo("orcamentos", [item("orcamentos.ver"), item("orcamentos.aprovar")] as const);
    expect(c.todas).toEqual(["orcamentos.ver", "orcamentos.aprovar"]);
    expect(c.valida("orcamentos.ver")).toBe(true);
    expect(c.valida("cronogramas.ver")).toBe(false);
  });
  it("recusa chave fora da regra ou repetida", () => {
    expect(() => criarCatalogo("orcamentos", [item("ver")])).toThrow(/fora da regra/);
    expect(() => criarCatalogo("orcamentos", [item("orcamentos.ver"), item("orcamentos.ver")])).toThrow(/repetida/);
  });
});

describe("pode", () => {
  it("administrador pode tudo; sem usuário, nada", () => {
    expect(pode({ administrador: true }, "x.y")).toBe(true);
    expect(pode({ permissoes: ["x.y"] }, "x.y")).toBe(true);
    expect(pode({ permissoes: ["x.y"] }, "x.z")).toBe(false);
    expect(pode(null, "x.y")).toBe(false);
  });
  it("exigirAdministrador responde 403", () => {
    expect(() => exigirAdministrador({ administrador: false })).toThrow(/Apenas administradores/);
    expect(() => exigirAdministrador({ administrador: true })).not.toThrow();
  });
});
