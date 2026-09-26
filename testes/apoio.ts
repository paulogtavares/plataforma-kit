/** Banco mínimo (usuarios, perfis, sessoes) num PGlite em memória, para testar o kit sozinho. */
import { PGlite } from "@electric-sql/pglite";
import type { BancoComTransacao } from "../src/tipos.js";
import type { MotorMigracao } from "../src/migrador.js";
import { gerarHashSenha } from "../src/seguranca.js";

export const ESTRUTURA = `
  CREATE TABLE perfis (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nome text NOT NULL, permissoes text[] NOT NULL DEFAULT '{}');
  CREATE TABLE usuarios (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nome text NOT NULL, email text NOT NULL UNIQUE,
    tipo text NOT NULL DEFAULT 'interno', cliente_id uuid, administrador boolean NOT NULL DEFAULT false,
    precisa_trocar_senha boolean NOT NULL DEFAULT false, perfil_id uuid REFERENCES perfis(id),
    ativo boolean NOT NULL DEFAULT true, senha_hash text, ultimo_acesso timestamptz);
  CREATE TABLE sessoes (token_hash text PRIMARY KEY, usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira_em timestamptz NOT NULL, ip text, agente text);`;

export async function bancoDeTeste() {
  const db = await PGlite.create();
  const banco: BancoComTransacao & { motor: MotorMigracao; fechar(): Promise<void> } = {
    query: async (sql, params) => {
      const r = await db.query<any>(sql, params as any[]);
      return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 };
    },
    tx: (_usuario, fn) =>
      db.transaction((t) =>
        fn({ query: async (sql, params) => { const r = await t.query<any>(sql, params as any[]); return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 }; } }),
      ),
    motor: {
      query: async (sql, params) => { const r = await db.query<any>(sql, params as any[]); return { rows: r.rows, rowCount: r.rows.length }; },
      exec: async (sql) => void (await db.exec(sql)),
      tx: (fn) => db.transaction((t) => fn({ query: async (sql, params) => { const r = await t.query<any>(sql, params as any[]); return { rows: r.rows, rowCount: r.rows.length }; }, exec: async (sql) => void (await t.exec(sql)) })),
    },
    fechar: () => db.close(),
  };
  return banco;
}

/** Estrutura + um perfil e três usuários (ana admin, beto comum, caio inativo), senha "Senha123". */
export async function bancoComUsuarios() {
  const banco = await bancoDeTeste();
  await banco.motor.exec(ESTRUTURA);
  const hash = await gerarHashSenha("Senha123");
  const { rows } = await banco.query<{ id: string }>("INSERT INTO perfis (nome, permissoes) VALUES ('Equipe', '{mod.ver}') RETURNING id");
  await banco.query(
    `INSERT INTO usuarios (nome, email, administrador, perfil_id, senha_hash, ativo) VALUES
      ('Ana', 'ana@x.com', true, $1, $2, true), ('Beto', 'beto@x.com', false, $1, $2, true), ('Caio', 'caio@x.com', false, $1, $2, false)`,
    [rows[0].id, hash],
  );
  return banco;
}
