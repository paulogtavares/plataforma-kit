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
    // só a estrutura inicial fica registrada; a migração que falhou, não
    expect((await b.query("SELECT nome FROM migracoes ORDER BY nome")).rows.map((r: any) => r.nome)).toEqual([
      "01.sql",
    ]);
    await b.fechar();
  });
});

describe("migrador com schema do módulo (troca de schema)", () => {
  const base = [
    { nome: "01.sql", sql: "CREATE TYPE cor AS ENUM ('azul'); CREATE TABLE coisas (id int PRIMARY KEY, c cor);" },
  ];
  // migração que move tudo de public para o schema (e é inofensiva num banco que já nasceu no schema)
  const mover = {
    nome: "m/08.sql",
    sql: `DO $$ BEGIN
      IF to_regclass('public.coisas') IS NOT NULL THEN ALTER TABLE public.coisas SET SCHEMA mod; END IF;
      IF to_regclass('public.migracoes') IS NOT NULL THEN ALTER TABLE public.migracoes SET SCHEMA mod; END IF;
      IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cor' AND typnamespace = 'public'::regnamespace) THEN ALTER TYPE public.cor SET SCHEMA mod; END IF;
    END $$;`,
  };
  const opcoes = (migracoes: { nome: string; sql: string }[]) => ({
    schema: "mod",
    tabelaReferencia: ["mod.coisas", "public.coisas"],
    base,
    migracoes,
    log: () => {},
  });
  const ondeEsta = async (b: any, nome: string) =>
    (await b.query("SELECT table_schema AS s FROM information_schema.tables WHERE table_name = $1", [nome])).rows.map(
      (r: any) => r.s,
    );

  it("banco novo: estrutura e registro nascem no schema, com a estrutura registrada", async () => {
    const b = await bancoDeTeste();
    await b.motor.exec("SET search_path = mod, public");
    expect(await migrar(b.motor, opcoes([mover]))).toEqual(["01.sql", "m/08.sql"]);
    expect(await ondeEsta(b, "coisas")).toEqual(["mod"]);
    expect(await ondeEsta(b, "migracoes")).toEqual(["mod"]);
    expect((await b.query("SELECT nome FROM migracoes ORDER BY nome")).rows.map((r: any) => r.nome)).toEqual([
      "01.sql",
      "m/08.sql",
    ]);
    expect(await migrar(b.motor, opcoes([mover]))).toEqual([]);
    await b.fechar();
  });

  it("banco antigo em public: usa o registro antigo, não reaplica a estrutura e move tudo sem perder nada", async () => {
    const b = await bancoDeTeste();
    // versão anterior: tudo em public, com uma migração já registrada
    await migrar(b.motor, {
      tabelaReferencia: "public.coisas",
      base,
      migracoes: [{ nome: "m/05.sql", sql: "INSERT INTO coisas VALUES (1, 'azul');" }],
      log: () => {},
    });
    await b.motor.exec("SET search_path = mod, public");
    const log: string[] = [];
    const r = await migrar(b.motor, {
      ...opcoes([{ nome: "m/05.sql", sql: "SELECT 1/0;" }, mover]),
      log: (m) => log.push(m),
    });
    expect(r).toEqual(["m/08.sql"]); // 05 não roda de novo (o registro antigo foi encontrado) e a base não é reaplicada
    expect(log.some((m) => m.startsWith("Aplicando"))).toBe(false);
    expect(await ondeEsta(b, "coisas")).toEqual(["mod"]);
    expect(await ondeEsta(b, "migracoes")).toEqual(["mod"]);
    expect((await b.query("SELECT * FROM coisas")).rows).toEqual([{ id: 1, c: "azul" }]);
    expect((await b.query("SELECT nome FROM migracoes ORDER BY nome")).rows.map((x: any) => x.nome)).toEqual([
      "01.sql",
      "m/05.sql",
      "m/08.sql",
    ]);
    expect(await migrar(b.motor, opcoes([mover]))).toEqual([]); // reiniciar não reaplica nada
    await b.fechar();
  });

  it("banco antigo sem registro nenhum (modo navegador): cria o registro no schema e roda as pendentes", async () => {
    const b = await bancoDeTeste();
    await b.motor.exec(base[0].sql);
    await b.motor.exec("SET search_path = mod, public");
    expect(await migrar(b.motor, opcoes([mover]))).toEqual(["m/08.sql"]);
    expect(await ondeEsta(b, "coisas")).toEqual(["mod"]);
    await b.fechar();
  });

  it("recusa rodar se o schema não for o primeiro do search_path", async () => {
    const b = await bancoDeTeste();
    await expect(migrar(b.motor, opcoes([]))).rejects.toThrow(/search_path = mod, public/);
    await expect(migrar(b.motor, { ...opcoes([]), schema: "Mod; DROP" })).rejects.toThrow(/Schema inválido/);
    await b.fechar();
  });

  it("troca de schema que falha no meio é desfeita por inteiro", async () => {
    const b = await bancoDeTeste();
    await migrar(b.motor, { tabelaReferencia: "public.coisas", base, migracoes: [], log: () => {} });
    await b.motor.exec("SET search_path = mod, public");
    const quebrada = { nome: "m/08.sql", sql: "ALTER TABLE public.coisas SET SCHEMA mod; SELECT 1/0;" };
    await expect(migrar(b.motor, opcoes([quebrada]))).rejects.toThrow();
    expect(await ondeEsta(b, "coisas")).toEqual(["public"]);
    expect((await b.query("SELECT count(*)::int AS n FROM migracoes WHERE nome = 'm/08.sql'")).rows[0].n).toBe(0);
    await b.fechar();
  });
});
