/**
 * Token da plataforma (AUTH_MODO=portal): o portal autentica a pessoa e repassa cada requisição
 * ao módulo com um token curto no cabeçalho X-Plataforma-Token.
 *
 * Formato: JWT compacto assinado com HMAC-SHA256 (HS256) e o segredo SEGREDO_PLATAFORMA,
 * compartilhado entre o portal e os módulos. Declarações (contrato do plano, fases 1 e 2):
 *   iss        "portal" (obrigatório)
 *   aud        id do módulo, ou lista de ids (obrigatório): token de um módulo não vale em outro
 *   sub        id do usuário no portal, uuid (obrigatório)
 *   email      e-mail do usuário (obrigatório)
 *   tipo       "interno" ou "externo" (obrigatório)
 *   permissoes lista de chaves do módulo (obrigatório; as que não estão no catálogo são ignoradas)
 *   exp        validade em segundos (obrigatório, poucos minutos); iat opcional
 *   nome, cliente_id (uuid ou null), admin (boolean): opcionais
 *
 * Usa Web Crypto (sem dependências), então roda no Node e no navegador.
 */
import { ErroApi } from "./erros.js";

/** Nome do cabeçalho (em minúsculas, como o Node entrega). */
export const CABECALHO_TOKEN = "x-plataforma-token";
/** Emissor exigido no token. */
export const EMISSOR = "portal";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O que o portal assina. */
export interface DeclaracoesPlataforma {
  iss: string;
  aud: string | string[];
  sub: string;
  email: string;
  tipo: "interno" | "externo";
  permissoes: string[];
  exp: number;
  iat?: number;
  nome?: string;
  cliente_id?: string | null;
  admin?: boolean;
  [outra: string]: unknown;
}

/** O que o módulo recebe depois de conferir (e-mail normalizado, nome e cliente preenchidos). */
export interface TokenPlataforma extends DeclaracoesPlataforma {
  nome: string;
  cliente_id: string | null;
  admin: boolean;
}

export interface OpcoesVerificacao {
  /** SEGREDO_PLATAFORMA (mínimo 32 caracteres) */
  segredo: string;
  /** id deste módulo: precisa estar em aud */
  modulo: string;
  /** folga para diferença de relógio, em segundos (padrão 30) */
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
  const bin = atob(texto.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((texto.length + 3) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
const chave = (segredo: string, uso: KeyUsage) =>
  globalThis.crypto.subtle.importKey("raw", codificador.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, [
    uso,
  ]);

export function validarSegredo(segredo: string | undefined): string {
  if (!segredo || segredo.length < 32) throw new Error("SEGREDO_PLATAFORMA precisa ter pelo menos 32 caracteres.");
  return segredo;
}

/** Gera um token (usado nos testes e como referência para a equipe do portal). */
export async function assinarTokenPlataforma(declaracoes: DeclaracoesPlataforma, segredo: string) {
  const cabecalho = base64url(codificador.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const corpo = base64url(codificador.encode(JSON.stringify(declaracoes)));
  const assinatura = await globalThis.crypto.subtle.sign(
    "HMAC",
    await chave(segredo, "sign"),
    codificador.encode(`${cabecalho}.${corpo}`),
  );
  return `${cabecalho}.${corpo}.${base64url(new Uint8Array(assinatura))}`;
}

/** Confere assinatura, algoritmo, validade, emissor, destino e campos. Lança ErroApi 401 com motivo genérico. */
export async function verificarTokenPlataforma(
  token: string,
  o: OpcoesVerificacao,
  agora = Date.now(),
): Promise<TokenPlataforma> {
  const recusar = (motivo: string): never => {
    const e = new ErroApi(401, "Acesso pelo portal inválido ou expirado. Entre novamente pelo portal.");
    (e as any).motivo = motivo; // para o log; não vai para a tela
    throw e;
  };
  const partes = token.split(".");
  if (partes.length !== 3) recusar("formato");
  const [c, d, a] = partes;
  let cabecalho: any;
  let dados: any;
  let assinatura: Uint8Array<ArrayBuffer>;
  try {
    cabecalho = JSON.parse(new TextDecoder().decode(deBase64url(c)));
    dados = JSON.parse(new TextDecoder().decode(deBase64url(d)));
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
  const folga = o.folgaSegundos ?? 30;
  const segundos = Math.floor(agora / 1000);
  if (typeof dados?.exp !== "number" || dados.exp + folga < segundos) recusar("expirado");
  if (typeof dados.iat === "number" && dados.iat - folga > segundos) recusar("emitido no futuro");
  if (dados.iss !== EMISSOR) recusar(`emissor ${dados.iss}`);
  const destinos = Array.isArray(dados.aud) ? dados.aud : [dados.aud];
  if (!destinos.includes(o.modulo)) recusar(`destino ${dados.aud}`);
  if (typeof dados.sub !== "string" || !UUID.test(dados.sub)) recusar("sub");
  if (typeof dados.email !== "string" || !dados.email.includes("@")) recusar("email");
  if (dados.tipo !== "interno" && dados.tipo !== "externo") recusar("tipo");
  if (dados.cliente_id != null && (typeof dados.cliente_id !== "string" || !UUID.test(dados.cliente_id)))
    recusar("cliente_id");
  if (!Array.isArray(dados.permissoes) || dados.permissoes.some((p: unknown) => typeof p !== "string"))
    recusar("permissoes");
  const email = dados.email.trim().toLowerCase();
  return {
    ...dados,
    email,
    nome: typeof dados.nome === "string" && dados.nome.trim() ? dados.nome.trim().slice(0, 200) : email.split("@")[0],
    cliente_id: dados.cliente_id ?? null,
    admin: dados.admin === true,
  };
}
