/**
 * Base de servidor comum dos módulos (Fastify):
 *  - cabeçalhos de segurança (iframe só do mesmo domínio), corpo JSON vazio aceito;
 *  - rotas padrão /api/saude, /api/status, /modulo.json e as de login (autenticacao.ts);
 *  - autenticação de toda rota /api/* que não for pública;
 *  - erros no formato { erro, codigo } com o mesmo código no log;
 *  - entrega do front com o prefixo do portal (X-Forwarded-Prefix ou BASE_PATH) no <base href>.
 */
import type { FastifyInstance } from "fastify";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { rotasAutenticacao } from "./autenticacao.js";
import { ErroApi, traduzirErroPg } from "./erros.js";
import type { ItemCatalogo } from "./permissoes.js";
import type { Sessao } from "./sessao.js";
import type { BancoComTransacao } from "./tipos.js";

// ---------------------------------------------------------------- prefixo de publicação

/** Normaliza para "/" ou "/algo/"; recusa (volta para "/") qualquer coisa fora de letras, números e . _ ~ - / */
export function normalizarPrefixo(valor: string | undefined | null): string {
  const bruto = (valor ?? "").trim();
  if (!bruto) return "/";
  const limpo = `/${bruto}/`.replace(/\/{2,}/g, "/");
  if (!/^[A-Za-z0-9._~\-/]+$/.test(limpo) || limpo.includes("/../") || limpo.includes("/./")) return "/";
  return limpo;
}

/** Prefixo desta requisição: o do proxy, se houver; senão BASE_PATH; senão "/". */
export function prefixoDaRequisicao(
  cabecalho: string | string[] | undefined,
  basePath = process.env.BASE_PATH,
): string {
  const doProxy = Array.isArray(cabecalho) ? cabecalho[0] : cabecalho;
  // proxies em cadeia podem mandar "a, b": vale o primeiro (o mais externo)
  const primeiro = doProxy?.split(",")[0];
  return normalizarPrefixo(primeiro?.trim() ? primeiro : basePath);
}

/** Escreve o prefixo no <base href> do index.html (a tela lê dali o basename e o caminho da API). */
export function aplicarPrefixo(html: string, prefixo: string): string {
  const tag = `<base href="${prefixo}" />`;
  return /<base href="[^"]*"\s*\/?>/.test(html)
    ? html.replace(/<base href="[^"]*"\s*\/?>/, tag)
    : html.replace(/<head>/i, `<head>\n    ${tag}`);
}

// ---------------------------------------------------------------- base do servidor

export interface OpcoesServidor {
  sessao: Sessao<any>;
  banco: BancoComTransacao;
  producao: boolean;
  versao: string;
  data: string;
  /** "postgres" ou "embutido", lido a cada /api/status */
  tipoBanco: () => string;
  /** catálogo de permissões do módulo (vai no /modulo.json) */
  permissoes: readonly ItemCatalogo[];
  /** conteúdo fixo do modulo.json; sem ele, /modulo.json não é publicado */
  manifesto?: Record<string, unknown>;
  /** usuários e senha de teste mostrados na tela de login (só com o modo de teste ligado) */
  acessoTeste?: { senha: string; emails: { email: string; perfil: string }[] };
  /** mensagens das constraints do módulo */
  restricoes?: Record<string, string>;
  textoValorNaoPermitido?: string;
  log?: (msg: string) => void;
}

const logPadrao = (msg: string) => console.log(new Date().toLocaleTimeString("pt-BR"), msg);

export async function prepararServidor(app: FastifyInstance, o: OpcoesServidor) {
  const log = o.log ?? logPadrao;

  // cabeçalhos de segurança em todas as respostas; iframe só do mesmo domínio (o portal)
  app.addHook("onSend", async (_req, reply, corpo) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "SAMEORIGIN");
    reply.header("Content-Security-Policy", "frame-ancestors 'self'");
    reply.header("Referrer-Policy", "same-origin");
    if (o.producao) reply.header("Strict-Transport-Security", "max-age=31536000");
    return corpo;
  });

  // aceita corpo JSON vazio (ex.: POST de ação sem parâmetros)
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, corpo, done) => {
    const texto = String(corpo ?? "").trim();
    if (!texto) return done(null, {});
    try {
      done(null, JSON.parse(texto));
    } catch {
      const e: any = new Error("JSON inválido no corpo da requisição.");
      e.statusCode = 400;
      done(e, undefined);
    }
  });

  app.get("/api/saude", { config: { publica: true } }, async () => ({ ok: true }));
  app.get("/api/status", { config: { publica: true } }, async () => {
    // no modo portal ninguém tem senha local: conta qualquer administrador ativo
    const semSenhaLocal = o.sessao.modo === "portal";
    const admins = await o.banco.query(
      `SELECT count(*)::int AS n FROM usuarios WHERE administrador AND ativo ${semSenhaLocal ? "" : "AND senha_hash IS NOT NULL"}`,
    );
    return {
      ok: true,
      version: o.versao,
      buildDate: o.data,
      banco: o.tipoBanco(),
      node: process.version,
      ambiente: o.producao ? "producao" : "local",
      modo_teste: !!o.acessoTeste,
      autenticacao: o.sessao.modo,
      // com o modo de teste ligado, a tela de login mostra os usuários de teste
      ...(o.acessoTeste ? { acesso_teste: o.acessoTeste } : {}),
      sem_administrador: admins.rows[0].n === 0,
    };
  });

  // manifesto para o portal: menu, versão, modo de login e catálogo de permissões (sem login)
  if (o.manifesto) {
    const manifesto = {
      ...o.manifesto,
      versao: o.versao,
      data: o.data,
      autenticacao: o.sessao.modo,
      permissoes: o.permissoes,
    };
    app.get("/modulo.json", { config: { publica: true } }, async (_req, reply) => {
      reply.header("Cache-Control", "no-cache");
      return manifesto;
    });
  }

  app.addHook("onRequest", async (req) => {
    if (!req.url.startsWith("/api/") || req.routeOptions.config?.publica) return;
    // o módulo declara o tipo de req.usuario (com as chaves de permissão dele)
    (req as any).usuario = await o.sessao.autenticar(req);
  });

  // erros no formato { erro, codigo }: o mesmo código curto aparece na tela e no log
  app.setErrorHandler((err: any, req, reply) => {
    const codigo = randomBytes(2).toString("hex").toUpperCase();
    if (err?.name === "ZodError" && Array.isArray(err.issues)) {
      return reply.code(400).send({ erro: err.issues[0]?.message ?? "Dados inválidos.", codigo, detalhes: err.issues });
    }
    if (err instanceof ErroApi) return reply.code(err.status).send({ erro: err.message, codigo });
    const pg = traduzirErroPg(err, o.restricoes, o.textoValorNaoPermitido);
    if (pg) return reply.code(pg.status).send({ erro: pg.message, codigo });
    if (err?.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ erro: err.message || "Requisição inválida.", codigo });
    }
    req.log.error(err);
    log(`[erro ${codigo}] ${req.method} ${req.url.split("?")[0]}: ${err?.message ?? err}`);
    if (err?.stack) console.error(String(err.stack).split("\n").slice(0, 6).join("\n"));
    return reply.code(500).send({
      erro: `Erro interno (código ${codigo}). Informe este código ao responsável técnico; o detalhe está no log do servidor.`,
      codigo,
    });
  });

  await app.register(rotasAutenticacao, { sessao: o.sessao, banco: o.banco, producao: o.producao });
}

// ---------------------------------------------------------------- entrega do front

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

/** Serve o front compilado (pasta/public); o index.html sai com o prefixo da requisição. */
export function servirFront(app: FastifyInstance, pasta: string | undefined) {
  app.setNotFoundHandler((req, reply) => {
    // HEAD também: monitores de disponibilidade costumam usar HEAD /
    if (req.url.startsWith("/api/") || !pasta || (req.method !== "GET" && req.method !== "HEAD")) {
      return reply.code(404).send({ erro: "Rota não encontrada." });
    }
    const base = resolve(pasta, "public");
    let caminho: string;
    try {
      caminho = normalize(join(base, decodeURIComponent(req.url.split("?")[0])));
    } catch {
      return reply.code(400).send({ erro: "Endereço inválido." });
    }
    const dentro = caminho.startsWith(base + sep) || caminho === base;
    const indice = join(base, "index.html");
    const arquivo = dentro && existsSync(caminho) && statSync(caminho).isFile() ? caminho : indice;
    if (arquivo === indice) {
      const prefixo = prefixoDaRequisicao(req.headers["x-forwarded-prefix"]);
      return reply
        .header("Content-Type", TIPOS[".html"])
        .header("Cache-Control", "no-cache")
        .header("Vary", "X-Forwarded-Prefix")
        .send(aplicarPrefixo(readFileSync(indice, "utf8"), prefixo));
    }
    const ehAtivo = arquivo.includes(`${sep}assets${sep}`);
    return reply
      .header("Content-Type", TIPOS[extname(arquivo)] ?? "application/octet-stream")
      .header("Cache-Control", ehAtivo ? "public, max-age=31536000, immutable" : "no-cache")
      .send(readFileSync(arquivo));
  });
}
