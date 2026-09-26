/**
 * Rotas de login do modo local: entrar, sair, quem sou eu e trocar senha.
 * No modo portal, entrar e trocar senha respondem que o acesso é pelo portal.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { ErroApi } from "./erros.js";
import { hashToken, lerCookie, type Sessao } from "./sessao.js";
import {
  conferirSenha,
  gerarHashSenha,
  gerarToken,
  hashParaComparacaoFalsa,
  limparErros,
  minutosBloqueado,
  registrarErro,
  validarForcaSenha,
} from "./seguranca.js";
import type { BancoComTransacao } from "./tipos.js";

declare module "fastify" {
  interface FastifyContextConfig {
    /** rota sem login (o módulo não chama autenticar antes dela) */
    publica?: boolean;
  }
}

export interface OpcoesAutenticacao {
  sessao: Sessao<any>;
  banco: BancoComTransacao;
  /** em produção o cookie sai com Secure (só HTTPS) */
  producao: boolean;
  /** validade da sessão no banco, renovada com o uso (padrão 7 dias) */
  duracaoDias?: number;
}

const SO_PORTAL = "Neste ambiente o acesso é feito pelo portal.";

export async function rotasAutenticacao(app: FastifyInstance, o: OpcoesAutenticacao) {
  const { sessao, banco } = o;
  const duracao = o.duracaoDias ?? 7;

  function gravarCookie(reply: FastifyReply, token: string | null) {
    const partes = [
      `${sessao.nomeCookie}=${token ? encodeURIComponent(token) : ""}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      // o banco controla a validade real (renovada com o uso); o cookie dura mais
      token ? `Max-Age=${60 * 60 * 24 * 30}` : "Max-Age=0",
    ];
    if (o.producao) partes.push("Secure");
    reply.header("Set-Cookie", partes.join("; "));
  }

  app.post("/api/auth/entrar", { config: { publica: true } }, async (req, reply) => {
    if (sessao.modo === "portal") throw new ErroApi(400, SO_PORTAL);
    const b = z
      .object({
        email: z.string().trim().toLowerCase().min(1, "Informe o e-mail."),
        senha: z.string().min(1, "Informe a senha."),
      })
      .parse(req.body);

    const chaves = [`email:${b.email}`];
    const bloqueio = minutosBloqueado(chaves);
    if (bloqueio) {
      throw new ErroApi(
        429,
        `Muitas tentativas erradas. Tente de novo em ${bloqueio} minuto${bloqueio > 1 ? "s" : ""}.`,
      );
    }

    const { rows } = await banco.query<{ id: string; senha_hash: string | null }>(
      "SELECT id, senha_hash FROM usuarios WHERE lower(email) = $1 AND ativo",
      [b.email],
    );
    const u = rows[0];
    // mesmo custo com ou sem usuário: não revela quais e-mails existem
    const ok = await conferirSenha(b.senha, u?.senha_hash ?? (await hashParaComparacaoFalsa()));
    if (!u || !u.senha_hash || !ok) {
      registrarErro(chaves);
      throw new ErroApi(401, "E-mail ou senha incorretos.");
    }
    limparErros(chaves);

    const token = gerarToken();
    await banco.tx(u.id, async (c) => {
      await c.query("DELETE FROM sessoes WHERE expira_em < now()");
      await c.query(
        `INSERT INTO sessoes (token_hash, usuario_id, expira_em, ip, agente)
         VALUES ($1, $2, now() + make_interval(days => $3), $4, $5)`,
        [await hashToken(token), u.id, duracao, req.ip, String(req.headers["user-agent"] ?? "").slice(0, 200)],
      );
      await c.query("UPDATE usuarios SET ultimo_acesso = now() WHERE id = $1", [u.id]);
    });
    gravarCookie(reply, token);
    return sessao.carregarUsuario(u.id);
  });

  app.post("/api/auth/sair", { config: { publica: true } }, async (req, reply) => {
    const token = lerCookie(req, sessao.nomeCookie);
    if (token) await banco.query("DELETE FROM sessoes WHERE token_hash = $1", [await hashToken(token)]);
    gravarCookie(reply, null);
    return { ok: true };
  });

  /** Quem está logado. Responde mesmo com troca de senha pendente (a tela precisa saber). */
  app.get("/api/eu", { config: { publica: true } }, async (req) =>
    sessao.autenticar(req, { permitirTrocaPendente: true }),
  );

  app.post("/api/auth/trocar-senha", { config: { publica: true } }, async (req) => {
    if (sessao.modo === "portal") throw new ErroApi(400, SO_PORTAL);
    const usuario = await sessao.autenticar(req, { permitirTrocaPendente: true });
    const b = z
      .object({ senha_atual: z.string().min(1, "Informe a senha atual."), nova_senha: z.string() })
      .parse(req.body);
    const fraca = validarForcaSenha(b.nova_senha);
    if (fraca) throw new ErroApi(400, fraca);
    if (b.nova_senha === b.senha_atual) throw new ErroApi(400, "A nova senha precisa ser diferente da atual.");

    const { rows } = await banco.query<{ senha_hash: string }>("SELECT senha_hash FROM usuarios WHERE id = $1", [
      usuario.id,
    ]);
    if (!(await conferirSenha(b.senha_atual, rows[0]?.senha_hash)))
      throw new ErroApi(400, "A senha atual está incorreta.");

    const tokenAtual = lerCookie(req, sessao.nomeCookie);
    const hashAtual = tokenAtual ? await hashToken(tokenAtual) : "";
    await banco.tx(usuario.id, async (c) => {
      await c.query("UPDATE usuarios SET senha_hash = $2, precisa_trocar_senha = false WHERE id = $1", [
        usuario.id,
        await gerarHashSenha(b.nova_senha),
      ]);
      // encerra as outras sessões (outros computadores), mantém a atual
      await c.query("DELETE FROM sessoes WHERE usuario_id = $1 AND token_hash <> $2", [usuario.id, hashAtual]);
    });
    return { ok: true };
  });
}
