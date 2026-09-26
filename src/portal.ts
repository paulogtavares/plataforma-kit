/**
 * Token do portal (AUTH_MODO=portal): o portal autentica a pessoa e repassa a requisição
 * ao módulo com um token no cabeçalho (padrão: X-Portal-Token).
 *
 * Formato: JWT compacto assinado com HMAC-SHA256 (HS256) com um segredo compartilhado
 * entre o portal e os módulos. Declarações usadas:
 *   email (obrigatório)  e-mail do usuário, igual ao cadastrado no módulo
 *   exp   (obrigatório)  validade, em segundos desde 1970 (tokens curtos: minutos)
 *   iat   (opcional)     emissão
 *   iss   (opcional)     emissor; conferido quando o módulo configura `emissor`
 *
 * Usa Web Crypto (sem dependências), então roda no Node e no navegador.
 */
import { ErroApi } from "./erros.js";

export interface DeclaracoesPortal {
  email: string;
  exp: number;
  iat?: number;
  iss?: string;
  [outra: string]: unknown;
}

export interface OpcoesPortal {
  /** segredo compartilhado com o portal (mínimo 32 caracteres) */
  segredo: string;
  /** se definido, o token precisa ter iss igual a este valor */
  emissor?: string;
  /** folga para diferença de relógio, em segundos (padrão 60) */
  folgaSegundos?: number;
}

const codificador = new TextEncoder();

function base64url(bytes: Uint8Array) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function deBase64url(texto: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(texto)) throw new Error("base64url inválido");
  const b64 = texto.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((texto.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
const chave = (segredo: string, uso: KeyUsage) =>
  globalThis.crypto.subtle.importKey("raw", codificador.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, [
    uso,
  ]);

export function validarSegredo(segredo: string | undefined): string {
  if (!segredo || segredo.length < 32) throw new Error("PORTAL_SEGREDO precisa ter pelo menos 32 caracteres.");
  return segredo;
}

/** Gera um token (usado nos testes e como referência para a equipe do portal). */
export async function assinarTokenPortal(declaracoes: DeclaracoesPortal, segredo: string) {
  const cabecalho = base64url(codificador.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const corpo = base64url(codificador.encode(JSON.stringify(declaracoes)));
  const assinatura = await globalThis.crypto.subtle.sign(
    "HMAC",
    await chave(segredo, "sign"),
    codificador.encode(`${cabecalho}.${corpo}`),
  );
  return `${cabecalho}.${corpo}.${base64url(new Uint8Array(assinatura))}`;
}

/** Confere assinatura, algoritmo, validade e emissor. Lança ErroApi 401 com motivo genérico para a tela. */
export async function verificarTokenPortal(
  token: string,
  o: OpcoesPortal,
  agora = Date.now(),
): Promise<DeclaracoesPortal> {
  const recusar = (motivo: string): never => {
    const e = new ErroApi(401, "Acesso pelo portal inválido ou expirado. Entre novamente pelo portal.");
    (e as any).motivo = motivo; // para o log; não vai para a tela
    throw e;
  };
  const partes = token.split(".");
  if (partes.length !== 3) recusar("formato");
  const [c, d, a] = partes;
  let cabecalho: any;
  let declaracoes: any;
  let assinatura: Uint8Array<ArrayBuffer>;
  try {
    cabecalho = JSON.parse(new TextDecoder().decode(deBase64url(c)));
    declaracoes = JSON.parse(new TextDecoder().decode(deBase64url(d)));
    assinatura = deBase64url(a);
  } catch {
    return recusar("codificação");
  }
  if (cabecalho?.alg !== "HS256") recusar(`algoritmo ${cabecalho?.alg}`); // recusa "none" e qualquer outro
  const valida = await globalThis.crypto.subtle.verify(
    "HMAC",
    await chave(o.segredo, "verify"),
    assinatura!,
    codificador.encode(`${c}.${d}`),
  );
  if (!valida) recusar("assinatura");
  const folga = o.folgaSegundos ?? 60;
  const segundos = Math.floor(agora / 1000);
  if (typeof declaracoes?.exp !== "number" || declaracoes.exp + folga < segundos) recusar("expirado");
  if (typeof declaracoes.iat === "number" && declaracoes.iat - folga > segundos) recusar("emitido no futuro");
  if (typeof declaracoes.email !== "string" || !declaracoes.email.includes("@")) recusar("sem e-mail");
  if (o.emissor && declaracoes.iss !== o.emissor) recusar("emissor");
  return { ...declaracoes, email: declaracoes.email.trim().toLowerCase() } as DeclaracoesPortal;
}
