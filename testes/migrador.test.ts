import { describe, expect, it } from "vitest";
import { migrar } from "../src/migrador.js";
import { bancoDeTeste } from "./apoio.js";

const base = [{ nome: "01.sql", sql: "CREATE TABLE coisas (id int PRIMARY KEY, nome text);" }];
const teste = [{ nome: "04.sql", sql: "INSERT INTO coisas VALUES (1, 'exemplo');" }];
const migracoes = [
  { nome: "m/05.sql", sql: "ALTER TABLE coisas ADD COLUMN cor text;" },
  { nome: "m/06.sql", sql: "UPDATE coisas SET cor = 'azul';" },
];

describe("migrador", () => {
  it("banco novo: base, teste e migrações, cada um uma vez", async () => {
    const b = await bancoDeTeste();
    const o = { tabelaReferencia: "public.coisas", base, teste, migracoes, log: () => {} };
    expect(await migrar(b.motor, o)).toEqual(["01.sql", "04.sql", "m/05.sql", "m/06.sql"]);
    expect(await migrar(b.motor, o)).toEqual([]); // reiniciar não reaplica nada
    expect((await b.query("SELECT cor FROM coisas")).rows).toEqual([{ cor: "azul" }]);
    await b.fechar();
  });
  it("banco existente: só as migrações novas", async () => {
    const b = await bancoDeTeste();
    await migrar(b.motor, { tabelaReferencia: "public.coisas", base, migracoes: migracoes.slice(0, 1), log: () => {} });
    expect(await migrar(b.motor, { tabelaReferencia: "public.coisas", base, migracoes, log: () => {} })).toEqual([
      "m/06.sql",
    ]);
    await b.fechar();
  });
  it("migração com erro é desfeita por inteiro e não fica registrada", async () => {
    const b = await bancoDeTeste();
    const ruim = [
      { nome: "m/07.sql", sql: "ALTER TABLE coisas ADD COLUMN x int; SELECT * FROM tabela_que_nao_existe;" },
    ];
    await expect(
      migrar(b.motor, { tabelaReferencia: "public.coisas", base, migracoes: ruim, log: () => {} }),
    ).rejects.toThrow();
    const colunas = await b.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'coisas' ORDER BY 1",
    );
    expect(colunas.rows.map((c: any) => c.column_name)).toEqual(["id", "nome"]);
    expect((await b.query("SELECT count(*)::int AS n FROM migracoes")).rows[0].n).toBe(0);
    await b.fechar();
  });
});
