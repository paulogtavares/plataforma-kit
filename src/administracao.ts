/**
 * Rotas de administração de usuários e perfis (modo local), iguais em todos os módulos.
 * Todas exigem administrador. Extraídas de api/src/rotas/admin.ts do Cronogramas.
 *
 *   GET    /api/admin/permissoes                     catálogo do módulo
 *   GET    /api/admin/perfis                         perfis com a quantidade de usuários ativos
 *   POST   /api/admin/perfis                         cria (permissões validadas pelo catálogo)
 *   PUT    /api/admin/perfis/:id                     edita (mantém o tipo dos usuários coerente)
 *   DELETE /api/admin/perfis/:id                     exclui (se ninguém usar)
 *   GET    /api/admin/usuarios                       lista
 *   POST   /api/admin/usuarios                       cria com senha provisória (mostrada uma vez)
 *   PATCH  /api/admin/usuarios/:id                   edita, ativa ou desativa (desativar derruba as sessões)
 *   POST   /api/admin/usuarios/:id/redefinir-senha   nova senha provisória
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ErroApi, naoEncontrado } from "./erros.js";
import { exigirAdministrador, type ItemCatalogo } from "./permissoes.js";
import { gerarHashSenha, gerarSenhaProvisoria } from "./seguranca.js";
import type { Banco, BancoComTransacao } from "./tipos.js";

export interface OpcoesAdministracao {
  banco: BancoComTransacao;
  /** catálogo de permissões do módulo */
  catalogo: readonly ItemCatalogo[];
  /**
   * Permissão que define o usuário interno (ex.: "cronogramas.visao.interna"): perfis com ela são "interno",
   * sem ela "externo", e só interno pode ser administrador. Sem esta opção, todos os usuários são internos.
   */
  permissaoInterna?: string;
  /** colunas e junções extras na listagem de usuários (ex.: nome do cliente, acessos do módulo) */
  usuarios?: { colunas?: string; juncoes?: string };
}

const uuid = z.string().uuid();

export async function rotasAdministracao(app: FastifyInstance, o: OpcoesAdministracao) {
  const { banco } = o;
  const validas = new Set(o.catalogo.map((p) => p.chave));
  const nomeInterna = o.catalogo.find((p) => p.chave === o.permissaoInterna)?.nome;
  if (o.permissaoInterna && !nomeInterna) throw new Error(`permissaoInterna "${o.permissaoInterna}" não está no catálogo.`);
  const ERRO_ADMIN_EXTERNO = `Administradores precisam de um perfil com a permissão “${nomeInterna}”.`;
  const usuarioDe = (req: unknown) => (req as { usuario: { id: string } }).usuario;

  const SELECT_USUARIOS = `
  SELECT u.id, u.nome, u.email, u.tipo, u.cliente_id${o.usuarios?.colunas ? `, ${o.usuarios.colunas}` : ""}, u.ativo, u.administrador,
         u.precisa_trocar_senha, u.ultimo_acesso, u.criado_em, (u.senha_hash IS NOT NULL) AS tem_senha,
         u.perfil_id, pf.nome AS perfil_nome
    FROM usuarios u
    ${o.usuarios?.juncoes ?? ""}
    LEFT JOIN perfis pf ON pf.id = u.perfil_id`;

  /** Perfil existe? E ele define usuário interno ou externo? */
  async function lerPerfil(c: Banco, perfilId: string) {
    const { rows } = await c.query<{ id: string; nome: string; interno: boolean }>(
      `SELECT id, nome, ${o.permissaoInterna ? "$2 = ANY(permissoes)" : "true"} AS interno FROM perfis WHERE id = $1`,
      o.permissaoInterna ? [perfilId, o.permissaoInterna] : [perfilId],
    );
    if (!rows[0]) throw new ErroApi(400, "Perfil de acesso não encontrado.");
    return rows[0];
  }

  // só administrador (vale para todas as rotas deste plugin)
  app.addHook("preHandler", async (req) => exigirAdministrador((req as any).usuario));

  // ---------------------------------------------------------------- perfis
  app.get("/api/admin/permissoes", async () => o.catalogo);

  app.get("/api/admin/perfis", async () => {
    const { rows } = await banco.query(
      `SELECT pf.id, pf.nome, pf.descricao, pf.permissoes, pf.atualizado_em,
              (SELECT count(*)::int FROM usuarios u WHERE u.perfil_id = pf.id AND u.ativo) AS qtd_usuarios
         FROM perfis pf ORDER BY pf.nome`,
    );
    return rows;
  });

  const corpoPerfil = z.object({
    nome: z.string().trim().min(1, "Informe o nome do perfil.").max(60),
    descricao: z.string().trim().max(400).nullish(),
    permissoes: z.array(z.string()).max(50),
  });
  const limparPermissoes = (lista: string[]) => {
    const invalida = lista.find((p) => !validas.has(p));
    if (invalida) throw new ErroApi(400, `Permissão desconhecida: ${invalida}`);
    return [...new Set(lista)];
  };

  app.post("/api/admin/perfis", async (req, reply) => {
    const b = corpoPerfil.parse(req.body);
    const r = await banco.tx(usuarioDe(req).id, (c) =>
      c.query<{ id: string }>("INSERT INTO perfis (nome, descricao, permissoes) VALUES ($1, $2, $3) RETURNING id", [
        b.nome,
        b.descricao || null,
        limparPermissoes(b.permissoes),
      ]),
    );
    reply.code(201);
    return { id: r.rows[0].id };
  });

  app.put<{ Params: { id: string } }>("/api/admin/perfis/:id", async (req) => {
    const b = corpoPerfil.parse(req.body);
    const permissoes = limparPermissoes(b.permissoes);
    const interno = !o.permissaoInterna || permissoes.includes(o.permissaoInterna);
    return banco.tx(usuarioDe(req).id, async (c) => {
      if (!interno) {
        // tirar a permissão interna de um perfil com administradores os deixaria sem acesso à administração
        const adm = await c.query<{ nome: string }>(
          "SELECT nome FROM usuarios WHERE perfil_id = $1 AND administrador AND ativo LIMIT 1",
          [req.params.id],
        );
        if (adm.rows[0]) {
          throw new ErroApi(400, `${adm.rows[0].nome} é administrador(a) e usa este perfil. ${ERRO_ADMIN_EXTERNO}`);
        }
      }
      const r = await c.query("UPDATE perfis SET nome = $2, descricao = $3, permissoes = $4 WHERE id = $1", [
        req.params.id,
        b.nome,
        b.descricao || null,
        permissoes,
      ]);
      if (!r.rowCount) throw naoEncontrado("Perfil");
      // mantém o "tipo" dos usuários coerente com o perfil
      await c.query(
        `UPDATE usuarios SET tipo = $2::tipo_usuario,
                cliente_id = CASE WHEN $2 = 'interno' THEN NULL ELSE cliente_id END
          WHERE perfil_id = $1 AND tipo <> $2::tipo_usuario`,
        [req.params.id, interno ? "interno" : "externo"],
      );
      return { ok: true };
    });
  });

  app.delete<{ Params: { id: string } }>("/api/admin/perfis/:id", async (req, reply) => {
    await banco.tx(usuarioDe(req).id, async (c) => {
      const em = await c.query<{ n: number }>("SELECT count(*)::int AS n FROM usuarios WHERE perfil_id = $1", [
        req.params.id,
      ]);
      if (em.rows[0].n > 0) {
        throw new ErroApi(
          400,
          `Este perfil está em uso por ${em.rows[0].n} usuário(s). Mude o perfil dessas pessoas antes de excluir.`,
        );
      }
      const r = await c.query("DELETE FROM perfis WHERE id = $1", [req.params.id]);
      if (!r.rowCount) throw naoEncontrado("Perfil");
    });
    reply.code(204);
  });

  // ---------------------------------------------------------------- usuários
  app.get("/api/admin/usuarios", async () => {
    const { rows } = await banco.query(`${SELECT_USUARIOS} ORDER BY u.ativo DESC, pf.nome, u.nome`);
    return rows;
  });

  /** Cria o usuário com uma senha provisória, mostrada UMA vez para o administrador repassar. */
  app.post("/api/admin/usuarios", async (req, reply) => {
    const b = z
      .object({
        nome: z.string().trim().min(1, "Informe o nome."),
        email: z.string().trim().toLowerCase().email("E-mail inválido."),
        perfil_id: uuid,
        cliente_id: uuid.nullish(),
        administrador: z.boolean().default(false),
      })
      .parse(req.body);
    const senha = gerarSenhaProvisoria();
    const id = await banco.tx(usuarioDe(req).id, async (c) => {
      const perfil = await lerPerfil(c, b.perfil_id);
      if (b.administrador && !perfil.interno) throw new ErroApi(400, ERRO_ADMIN_EXTERNO);
      const r = await c.query<{ id: string }>(
        `INSERT INTO usuarios (nome, email, tipo, perfil_id, cliente_id, administrador, senha_hash, precisa_trocar_senha)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING id`,
        [
          b.nome,
          b.email,
          perfil.interno ? "interno" : "externo",
          perfil.id,
          perfil.interno ? null : (b.cliente_id ?? null),
          b.administrador,
          await gerarHashSenha(senha),
        ],
      );
      return r.rows[0].id;
    });
    reply.code(201);
    return { id, senha_provisoria: senha };
  });

  app.patch<{ Params: { id: string } }>("/api/admin/usuarios/:id", async (req) => {
    const b = z
      .object({
        nome: z.string().trim().min(1),
        email: z.string().trim().toLowerCase().email("E-mail inválido."),
        perfil_id: uuid,
        cliente_id: uuid.nullable(),
        administrador: z.boolean(),
        ativo: z.boolean(),
      })
      .partial()
      .strict()
      .parse(req.body);
    const proprio = req.params.id === usuarioDe(req).id;
    if (proprio && (b.administrador === false || b.ativo === false)) {
      throw new ErroApi(400, "Você não pode remover o seu próprio acesso de administrador. Peça a outro administrador.");
    }
    if (!Object.keys(b).length) throw new ErroApi(400, "Nada para alterar.");

    return banco.tx(usuarioDe(req).id, async (c) => {
      const atual = await c.query<{ administrador: boolean; perfil_id: string | null }>(
        "SELECT administrador, perfil_id FROM usuarios WHERE id = $1",
        [req.params.id],
      );
      if (!atual.rows[0]) throw naoEncontrado("Usuário");
      const dados: Record<string, unknown> = { ...b };
      const perfilId = b.perfil_id ?? atual.rows[0].perfil_id;
      if (perfilId) {
        const perfil = await lerPerfil(c, perfilId);
        const seraAdmin = b.administrador ?? atual.rows[0].administrador;
        if (seraAdmin && !perfil.interno) throw new ErroApi(400, ERRO_ADMIN_EXTERNO);
        dados.tipo = perfil.interno ? "interno" : "externo";
        if (perfil.interno) dados.cliente_id = null;
      }
      const chaves = Object.keys(dados);
      const sets = chaves.map((k, i) => (k === "tipo" ? `tipo = $${i + 2}::tipo_usuario` : `${k} = $${i + 2}`)).join(", ");
      await c.query(`UPDATE usuarios SET ${sets} WHERE id = $1`, [req.params.id, ...chaves.map((k) => dados[k])]);
      // desativado: derruba as sessões abertas na hora
      if (b.ativo === false) await c.query("DELETE FROM sessoes WHERE usuario_id = $1", [req.params.id]);
      return { ok: true };
    });
  });

  app.post<{ Params: { id: string } }>("/api/admin/usuarios/:id/redefinir-senha", async (req) => {
    const senha = gerarSenhaProvisoria();
    await banco.tx(usuarioDe(req).id, async (c) => {
      const r = await c.query("UPDATE usuarios SET senha_hash = $2, precisa_trocar_senha = true WHERE id = $1", [
        req.params.id,
        await gerarHashSenha(senha),
      ]);
      if (!r.rowCount) throw naoEncontrado("Usuário");
      await c.query("DELETE FROM sessoes WHERE usuario_id = $1", [req.params.id]);
    });
    return { senha_provisoria: senha };
  });
}
