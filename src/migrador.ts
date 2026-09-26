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
  /** tabela que só existe depois da estrutura inicial (ex.: "public.projetos") */
  tabelaReferencia: string;
  /** estrutura e carga inicial: só num banco vazio */
  base: Script[];
  /** usuários de teste: só num banco vazio (passe [] com o modo de teste desligado) */
  teste?: Script[];
  /** em ordem; cada uma aplicada uma única vez */
  migracoes: Script[];
  log: (msg: string) => void;
}

export async function migrar(motor: MotorMigracao, o: OpcoesMigracao) {
  const aplicados: string[] = [];
  const r = await motor.query<{ existe: string | null }>("SELECT to_regclass($1)::text AS existe", [o.tabelaReferencia]);
  if (!r.rows[0]?.existe) {
    for (const s of [...o.base, ...(o.teste ?? [])]) {
      o.log(`Aplicando ${s.nome}…`);
      await motor.exec(s.sql);
      aplicados.push(s.nome);
    }
  }

  await motor.exec("CREATE TABLE IF NOT EXISTS migracoes (nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())");
  const feitas = new Set((await motor.query<{ nome: string }>("SELECT nome FROM migracoes")).rows.map((x) => x.nome));
  for (const mg of o.migracoes) {
    if (feitas.has(mg.nome)) continue;
    o.log(`Atualizando o banco: ${mg.nome}…`);
    await motor.tx(async (c) => {
      await c.exec(mg.sql);
      await c.query("INSERT INTO migracoes (nome) VALUES ($1)", [mg.nome]);
    });
    aplicados.push(mg.nome);
  }
  return aplicados;
}
