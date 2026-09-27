/**
 * Decisões que dependem do ambiente, iguais em todos os módulos:
 *  - produção: NODE_ENV=production; nuvem: produção, Railway ou DATABASE_URL fora deste computador;
 *  - modo de teste (usuários de exemplo): só com MODO_TESTE=1 e NUNCA em nuvem (lá a variável é ignorada);
 *  - endereço de escuta: HOST, se definido; em nuvem 0.0.0.0; no computador 127.0.0.1;
 *  - pasta dos dados: DADOS_DIR (nomes antigos do módulo aceitos por uma versão, com aviso);
 *  - login: AUTH_MODO=local (padrão) ou portal (exige SEGREDO_PLATAFORMA).
 */
import { validarSegredo } from "./portal.js";
import type { ModoAutenticacao } from "./sessao.js";

const LOCAL = /^(localhost|127\.0\.0\.1|::1|\[::1\])$/i;

/** DATABASE_URL aponta para fora deste computador? (URL inválida conta como nuvem, por segurança) */
export function bancoEmNuvem(url: string | undefined) {
  if (!url?.trim()) return false;
  try {
    return !LOCAL.test(new URL(url).hostname);
  } catch {
    return true;
  }
}

export interface OpcoesAmbiente {
  /** id do módulo (aud do token da plataforma e prefixo das permissões) */
  modulo: string;
  /** nome do cookie da sessão local quando COOKIE_SESSAO não está definida */
  cookiePadrao: string;
  /** nomes antigos da variável de pasta de dados (ex.: ["CRONOGRAMA_DADOS"]) */
  nomesAntigosDados?: string[];
}

export interface ConfiguracaoAcesso {
  modo: ModoAutenticacao;
  nomeCookie: string;
  modulo: string;
  segredoPlataforma?: string;
}

export function lerAmbiente(o: OpcoesAmbiente, env: NodeJS.ProcessEnv = process.env) {
  const avisos: string[] = [];
  /** problemas graves que o módulo deve mostrar em destaque no log */
  const erros: string[] = [];
  const producao = env.NODE_ENV === "production";
  const railway = !!env.RAILWAY_ENVIRONMENT || !!env.RAILWAY_ENVIRONMENT_NAME;
  const nuvem = producao || railway || bancoEmNuvem(env.DATABASE_URL);

  let modoTeste = env.MODO_TESTE === "1";
  if (env.MODO_TESTE && !modoTeste)
    avisos.push(`MODO_TESTE=${env.MODO_TESTE} ignorado: use MODO_TESTE=1 para ligar o modo de teste.`);
  if (modoTeste && nuvem) {
    modoTeste = false;
    const onde = producao ? "NODE_ENV=production" : railway ? "Railway" : "DATABASE_URL de nuvem";
    erros.push(`MODO_TESTE=1 IGNORADO (${onde}): usuários de teste nunca são liberados em nuvem. Apague a variável.`);
  }

  const host = env.HOST?.trim() || (nuvem ? "0.0.0.0" : "127.0.0.1");

  let dadosDir = env.DADOS_DIR?.trim() || undefined;
  for (const antigo of o.nomesAntigosDados ?? []) {
    const valor = env[antigo]?.trim();
    if (!valor) continue;
    if (dadosDir) avisos.push(`${antigo} ignorada: vale DADOS_DIR. Apague a variável antiga.`);
    else {
      dadosDir = valor;
      avisos.push(
        `${antigo} está obsoleta: renomeie para DADOS_DIR (o nome antigo deixa de funcionar na próxima versão).`,
      );
    }
  }

  return {
    producao,
    nuvem,
    modoTeste,
    host,
    porta: Number(env.PORT) || undefined,
    dadosDir,
    /** "producao" ou "local", como aparece no log e no /api/status */
    ambiente: (producao ? "producao" : "local") as "producao" | "local",
    acesso: lerAcesso(o, env),
    avisos,
    erros,
  };
}

/** Login: AUTH_MODO, COOKIE_SESSAO e SEGREDO_PLATAFORMA. Lança erro claro se a configuração for inválida. */
export function lerAcesso(o: OpcoesAmbiente, env: NodeJS.ProcessEnv = process.env): ConfiguracaoAcesso {
  const modo = (env.AUTH_MODO?.trim().toLowerCase() || "local") as ModoAutenticacao;
  if (modo !== "local" && modo !== "portal")
    throw new Error(`AUTH_MODO="${env.AUTH_MODO}" inválido: use local ou portal.`);
  const nomeCookie = env.COOKIE_SESSAO?.trim() || o.cookiePadrao;
  if (!/^[A-Za-z0-9_-]+$/.test(nomeCookie)) throw new Error("COOKIE_SESSAO só pode ter letras, números, _ e -.");
  if (modo === "local") return { modo, nomeCookie, modulo: o.modulo };
  return { modo, nomeCookie, modulo: o.modulo, segredoPlataforma: validarSegredo(env.SEGREDO_PLATAFORMA) };
}
