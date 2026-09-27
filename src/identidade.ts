/**
 * Tabelas de identidade (perfis, usuarios, sessoes) de todos os módulos.
 *  - scriptIdentidade(): o SQL do kit, para o migrador aplicar num banco novo antes da estrutura do módulo;
 *  - descreverIdentidade(): a estrutura real no banco, em formato comparável (testes de "tabelas idênticas").
 */
import type { Script } from "./migrador.js";
import type { Banco } from "./tipos.js";
import { SQL_IDENTIDADE } from "./identidadeSql.js";

export { SQL_IDENTIDADE };
export const TABELAS_IDENTIDADE = ["perfis", "usuarios", "sessoes"] as const;

/** O SQL de identidade como script do migrador (registrado como "plataforma-kit/identidade.sql"). */
export const scriptIdentidade = (): Script => ({ nome: "plataforma-kit/identidade.sql", sql: SQL_IDENTIDADE });

export interface DescricaoIdentidade {
  /** "tabela.coluna": "tipo | not null | default" */
  colunas: Record<string, string>;
  /** "tabela.nome_restricao": definição */
  restricoes: Record<string, string>;
  /** "tabela.nome_indice": definição (sem o schema) */
  indices: Record<string, string>;
  /** "tabela.nome_trigger": definição (sem o schema) */
  triggers: Record<string, string>;
  /** valores do enum tipo_usuario */
  tipoUsuario: string[];
}

/** Estrutura das tabelas de identidade no schema atual (primeiro do search_path), sem depender da ordem das colunas. */
export async function descreverIdentidade(banco: Banco): Promise<DescricaoIdentidade> {
  const tabelas = [...TABELAS_IDENTIDADE];
  const semSchema = (s: string) =>
    s.replace(/\b[a-z_][a-z0-9_]*\.(perfis|usuarios|sessoes|fn_tg_atualizado_em)\b/g, "$1");
  const col = await banco.query<{ t: string; c: string; tipo: string; nn: boolean; def: string | null }>(
    `SELECT a.attrelid::regclass::text AS t, a.attname AS c, format_type(a.atttypid, a.atttypmod) AS tipo,
            a.attnotnull AS nn, pg_get_expr(d.adbin, d.adrelid) AS def
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = ANY (SELECT to_regclass(x) FROM unnest($1::text[]) x) AND a.attnum > 0 AND NOT a.attisdropped`,
    [tabelas],
  );
  const res = await banco.query<{ t: string; n: string; def: string }>(
    `SELECT conrelid::regclass::text AS t, conname AS n, pg_get_constraintdef(oid) AS def
       FROM pg_constraint WHERE conrelid = ANY (SELECT to_regclass(x) FROM unnest($1::text[]) x)`,
    [tabelas],
  );
  const idx = await banco.query<{ t: string; n: string; def: string }>(
    `SELECT i.indrelid::regclass::text AS t, c.relname AS n, pg_get_indexdef(i.indexrelid) AS def
       FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE i.indrelid = ANY (SELECT to_regclass(x) FROM unnest($1::text[]) x)`,
    [tabelas],
  );
  const trg = await banco.query<{ t: string; n: string; def: string }>(
    `SELECT tgrelid::regclass::text AS t, tgname AS n, pg_get_triggerdef(oid) AS def
       FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = ANY (SELECT to_regclass(x) FROM unnest($1::text[]) x)`,
    [tabelas],
  );
  const enumr = await banco
    .query<{ v: string }>("SELECT unnest(enum_range(NULL::tipo_usuario))::text AS v")
    .catch(() => ({ rows: [] as { v: string }[], rowCount: 0 }));
  const chave = (t: string, n: string) => `${semSchema(t)}.${n}`;
  const ordenar = (o: Record<string, string>) =>
    Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  return {
    colunas: ordenar(
      Object.fromEntries(
        col.rows.map((r) => [chave(r.t, r.c), `${r.tipo} | ${r.nn ? "not null" : "null"} | ${r.def ?? ""}`]),
      ),
    ),
    restricoes: ordenar(Object.fromEntries(res.rows.map((r) => [chave(r.t, r.n), semSchema(r.def)]))),
    indices: ordenar(Object.fromEntries(idx.rows.map((r) => [chave(r.t, r.n), semSchema(r.def)]))),
    triggers: ordenar(Object.fromEntries(trg.rows.map((r) => [chave(r.t, r.n), semSchema(r.def)]))),
    tipoUsuario: enumr.rows.map((r) => r.v),
  };
}
