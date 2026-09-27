/** Banco mínimo (usuarios, perfis, sessoes) num PGlite em memória, para testar o kit sozinho. */
import { PGlite } from "@electric-sql/pglite";
import type { BancoComTransacao } from "../src/tipos.js";
import type { MotorMigracao } from "../src/migrador.js";
import { gerarHashSenha } from "../src/seguranca.js";
import { SQL_IDENTIDADE } from "../src/identidade.js";

/** Estrutura de identidade: o próprio SQL do kit (os testes rodam contra o que os módulos vão usar). */
export const ESTRUTURA = SQL_IDENTIDADE;

export async function bancoDeTeste() {
  const db = await PGlite.create();
  const banco: BancoComTransacao & { motor: MotorMigracao; fechar(): Promise<void> } = {
    query: async (sql, params) => {
      const r = await db.query<any>(sql, params as any[]);
      return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 };
    },
    tx: (_usuario, fn) =>
      db.transaction((t) =>
        fn({
          query: async (sql, params) => {
            const r = await t.query<any>(sql, params as any[]);
            return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 };
          },
        }),
      ),
    motor: {
      query: async (sql, params) => {
        const r = await db.query<any>(sql, params as any[]);
        return { rows: r.rows, rowCount: r.rows.length };
      },
      exec: async (sql) => void (await db.exec(sql)),
      tx: (fn) =>
        db.transaction((t) =>
          fn({
            query: async (sql, params) => {
              const r = await t.query<any>(sql, params as any[]);
              return { rows: r.rows, rowCount: r.rows.length };
            },
            exec: async (sql) => void (await t.exec(sql)),
          }),
        ),
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
  const { rows } = await banco.query<{ id: string }>(
    "INSERT INTO perfis (nome, permissoes) VALUES ('Equipe', '{mod.ver}') RETURNING id",
  );
  await banco.query(
    `INSERT INTO usuarios (nome, email, administrador, perfil_id, senha_hash, ativo, precisa_trocar_senha) VALUES
      ('Ana', 'ana@x.com', true, $1, $2, true, false), ('Beto', 'beto@x.com', false, $1, $2, true, false), ('Caio', 'caio@x.com', false, $1, $2, false, false)`,
    [rows[0].id, hash],
  );
  return banco;
}
