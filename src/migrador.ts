/**
 * Estrutura inicial e migrações do banco de um módulo.
 *  - Banco novo (sem a tabela de referência): aplica os scripts base (e os de teste, se vierem).
 *  - Migrações: cada uma roda uma única vez, dentro de uma transação, e fica registrada na tabela migracoes.
 * kit v1: tabela de referência e tabela migracoes no schema public (a v2.1.0 do Cronogramas passa
 * a usar o schema do módulo).
 */
import type { Resultado } from "./tipos.js";

export interface Script {
  nome: string;
  sql: string;
}

/** O que o migrador precisa do banco: consultas, scripts inteiros e transação. */
export interface MotorMigracao {
  query<T = any>(sql: string, params?: unknown[]): Promise<Resultado<T>>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (c: { query: MotorMigracao["query"]; exec(sql: string): Promise<void> }) => Promise<T>): Promise<T>;
}

export interface OpcoesMigracao {
  /**
   * Schema do módulo (ex.: "cronogramas"). O migrador cria o schema se não existir, e a tabela migracoes nasce nele.
   * A conexão precisa ter este schema em primeiro lugar no search_path (ex.: "cronogramas, public"): assim os scripts,
   * que não citam schema, criam os objetos nele. Sem esta opção, tudo fica no schema atual da conexão (como no kit 1.3).
   */
  schema?: string;
  /**
   * Tabela que só existe depois da estrutura inicial. Uma lista vale "qualquer uma delas", o que permite trocar de
   * schema sem o banco parecer vazio (ex.: ["cronogramas.projetos", "public.projetos"]).
   */
  tabelaReferencia: string | string[];
  /**
   * tabelas de identidade do kit (scriptIdentidade() de "plataforma-kit/identidade"): num banco novo, aplicadas
   * ANTES da estrutura do módulo. Módulos cuja estrutura já cria essas tabelas (o Cronogramas, de onde o SQL saiu)
   * não passam este campo.
   */
  identidade?: Script;
  /** estrutura e carga inicial: só num banco vazio (e registradas em migracoes) */
  base: Script[];
  /** usuários de teste: só num banco vazio (passe [] com o modo de teste desligado) */
  teste?: Script[];
  /** em ordem; cada uma aplicada uma única vez, numa transação */
  migracoes: Script[];
  log: (msg: string) => void;
}

const NOME_SCHEMA = /^[a-z_][a-z0-9_]*$/;

/**
 * Banco novo: identidade, estrutura e carga. Depois, as migrações pendentes.
 * O registro (tabela migracoes) é procurado pelo search_path, então um registro antigo em outro schema da lista
 * (ex.: public) continua valendo; uma migração pode movê-lo para o schema do módulo sem reaplicar nada.
 * Devolve os nomes dos scripts aplicados nesta execução.
 */
export async function migrar(motor: MotorMigracao, o: OpcoesMigracao) {
  const aplicados: string[] = [];
  if (o.schema) {
    if (!NOME_SCHEMA.test(o.schema)) throw new Error(`Schema inválido: "${o.schema}".`);
    await motor.exec(`CREATE SCHEMA IF NOT EXISTS ${o.schema}`);
    const r = await motor.query<{ primeiro: string | null }>("SELECT (current_schemas(false))[1] AS primeiro");
    if (r.rows[0]?.primeiro !== o.schema) {
      throw new Error(
        `A conexão precisa usar search_path = ${o.schema}, public (hoje o primeiro schema é "${r.rows[0]?.primeiro ?? "nenhum"}").`,
      );
    }
  }

  const candidatas = Array.isArray(o.tabelaReferencia) ? o.tabelaReferencia : [o.tabelaReferencia];
  let existe = false;
  for (const t of candidatas) {
    const r = await motor.query<{ existe: string | null }>("SELECT to_regclass($1)::text AS existe", [t]);
    if (r.rows[0]?.existe) existe = true;
  }
  const estrutura = [...(o.identidade ? [o.identidade] : []), ...o.base];
  if (!existe) {
    for (const s of [...estrutura, ...(o.teste ?? [])]) {
      o.log(`Aplicando ${s.nome}…`);
      await motor.exec(s.sql);
      aplicados.push(s.nome);
    }
  }

  // registro: o que o search_path achar (inclusive um antigo em public); só cria se não houver nenhum
  const reg = await motor.query<{ t: string | null }>("SELECT to_regclass('migracoes')::text AS t");
  if (!reg.rows[0]?.t) {
    await motor.exec(
      `CREATE TABLE ${o.schema ? `${o.schema}.` : ""}migracoes (nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())`,
    );
  }
  // a estrutura inicial também fica registrada (num banco existente, ela foi aplicada por uma versão anterior)
  for (const s of estrutura) {
    await motor.query("INSERT INTO migracoes (nome) VALUES ($1) ON CONFLICT (nome) DO NOTHING", [s.nome]);
  }

  const feitas = new Set((await motor.query<{ nome: string }>("SELECT nome FROM migracoes")).rows.map((x) => x.nome));
  for (const mg of o.migracoes) {
    if (feitas.has(mg.nome)) continue;
    o.log(`Atualizando o banco: ${mg.nome}…`);
    await motor.tx(async (c) => {
      await c.exec(mg.sql);
      // sem schema no nome: vale mesmo que a migração tenha acabado de mover o registro de schema
      await c.query("INSERT INTO migracoes (nome) VALUES ($1)", [mg.nome]);
    });
    aplicados.push(mg.nome);
  }
  return aplicados;
}
