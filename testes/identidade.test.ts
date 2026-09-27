import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { traduzirErroPg } from "../src/erros.js";
import { SQL_IDENTIDADE, descreverIdentidade, scriptIdentidade } from "../src/identidade.js";
import { migrar } from "../src/migrador.js";
import { bancoDeTeste } from "./apoio.js";

describe("sql/identidade.sql", () => {
  it("o SQL embutido no JavaScript é o mesmo do arquivo publicado", () => {
    expect(SQL_IDENTIDADE).toBe(readFileSync(new URL("../sql/identidade.sql", import.meta.url), "utf8"));
    expect(scriptIdentidade().nome).toBe("plataforma-kit/identidade.sql");
  });

  it("cria exatamente as colunas que o kit lê, com as restrições que ele traduz", async () => {
    const b = await bancoDeTeste();
    await b.motor.exec(SQL_IDENTIDADE);
    const d = await descreverIdentidade(b);
    expect(Object.keys(d.colunas)).toEqual([
      "perfis.atualizado_em",
      "perfis.criado_em",
      "perfis.descricao",
      "perfis.id",
      "perfis.nome",
      "perfis.permissoes",
      "sessoes.agente",
      "sessoes.criada_em",
      "sessoes.expira_em",
      "sessoes.ip",
      "sessoes.token_hash",
      "sessoes.usuario_id",
      "usuarios.administrador",
      "usuarios.ativo",
      "usuarios.atualizado_em",
      "usuarios.cliente_id",
      "usuarios.criado_em",
      "usuarios.email",
      "usuarios.id",
      "usuarios.nome",
      "usuarios.perfil_id",
      "usuarios.precisa_trocar_senha",
      "usuarios.senha_hash",
      "usuarios.tipo",
      "usuarios.ultimo_acesso",
    ]);
    expect(d.colunas["usuarios.tipo"]).toBe("tipo_usuario | not null | 'interno'::tipo_usuario");
    expect(d.colunas["usuarios.precisa_trocar_senha"]).toBe("boolean | not null | true");
    expect(d.restricoes["usuarios.ck_admin_interno"]).toBe(
      "CHECK (((NOT administrador) OR (tipo = 'interno'::tipo_usuario)))",
    );
    expect(d.restricoes["usuarios.usuarios_perfil_id_fkey"]).toBe(
      "FOREIGN KEY (perfil_id) REFERENCES perfis(id) ON DELETE RESTRICT",
    );
    expect(d.indices["usuarios.ux_usuarios_email"]).toMatch(
      /UNIQUE INDEX ux_usuarios_email ON usuarios USING btree \(lower\(email\)\)/,
    );
    expect(Object.keys(d.triggers)).toEqual(["perfis.tg_perfis_atualizado", "usuarios.tg_usuarios_atualizado"]);
    expect(d.tipoUsuario).toEqual(["interno", "externo"]);
    await b.fechar();
  });

  it("as violações saem com as mensagens do kit (e-mail repetido, administrador externo)", async () => {
    const b = await bancoDeTeste();
    await b.motor.exec(SQL_IDENTIDADE);
    await b.query("INSERT INTO usuarios (nome, email) VALUES ('A', 'a@x.com')");
    const repetido = await b.query("INSERT INTO usuarios (nome, email) VALUES ('B', 'A@X.com')").catch((e) => e);
    expect(traduzirErroPg(repetido)?.message).toBe("Já existe um usuário com esse e-mail.");
    const adminExterno = await b
      .query("INSERT INTO usuarios (nome, email, tipo, administrador) VALUES ('C', 'c@x.com', 'externo', true)")
      .catch((e) => e);
    expect(traduzirErroPg(adminExterno)?.message).toBe("Só usuários da equipe interna podem ser administradores.");
    await b.fechar();
  });

  it("sem schema fixo: cai no schema do módulo pelo search_path", async () => {
    const b = await bancoDeTeste();
    await b.motor.exec("CREATE SCHEMA orcamentos; SET search_path = orcamentos, public;");
    await b.motor.exec(SQL_IDENTIDADE);
    const r = await b.query(
      "SELECT table_schema, table_name FROM information_schema.tables WHERE table_name IN ('perfis','usuarios','sessoes') ORDER BY 2",
    );
    expect(r.rows).toEqual([
      { table_schema: "orcamentos", table_name: "perfis" },
      { table_schema: "orcamentos", table_name: "sessoes" },
      { table_schema: "orcamentos", table_name: "usuarios" },
    ]);
    const tipo = await b.query(
      "SELECT n.nspname AS s FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'tipo_usuario'",
    );
    expect(tipo.rows).toEqual([{ s: "orcamentos" }]);
    await b.fechar();
  });

  it("pode ser reaplicado sem erro e sem perder dados", async () => {
    const b = await bancoDeTeste();
    await b.motor.exec(SQL_IDENTIDADE);
    await b.query("INSERT INTO usuarios (nome, email) VALUES ('A', 'a@x.com')");
    await b.motor.exec(SQL_IDENTIDADE);
    expect((await b.query("SELECT count(*)::int AS n FROM usuarios")).rows[0].n).toBe(1);
    await b.fechar();
  });

  it("o migrador aplica a identidade antes da estrutura do módulo, só num banco novo", async () => {
    const b = await bancoDeTeste();
    const base = [
      { nome: "01.sql", sql: "CREATE TABLE orcamentos (id int PRIMARY KEY, autor uuid REFERENCES usuarios(id));" },
    ];
    const o = {
      tabelaReferencia: "public.orcamentos",
      identidade: scriptIdentidade(),
      base,
      migracoes: [],
      log: () => {},
    };
    expect(await migrar(b.motor, o)).toEqual(["plataforma-kit/identidade.sql", "01.sql"]);
    expect(await migrar(b.motor, o)).toEqual([]);
    await b.fechar();
  });
});
