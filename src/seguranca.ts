/**
 * Segurança do login (só no servidor Node).
 *  - Senhas: scrypt com sal aleatório (nativo do Node, sem bibliotecas externas)
 *  - Sessão: token aleatório no cookie; no banco fica só o hash (SHA-256) dele
 *  - Tentativas: bloqueio temporário após erros seguidos
 */
import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (senha: string, sal: Buffer, tamanho: number, opcoes: ScryptOptions) =>
  new Promise<Buffer>((ok, erro) => scryptCb(senha, sal, tamanho, opcoes, (e, chave) => (e ? erro(e) : ok(chave))));

const PARAMS = { N: 16384, r: 8, p: 1 };
const TAMANHO = 64;

/** Formato guardado: scrypt$N$r$p$sal(base64)$hash(base64) */
export async function gerarHashSenha(senha: string) {
  const sal = randomBytes(16);
  const hash = await scrypt(senha, sal, TAMANHO, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${sal.toString("base64")}$${hash.toString("base64")}`;
}

export async function conferirSenha(senha: string, guardado: string | null | undefined) {
  if (!guardado) return false;
  const [alg, n, r, p, salB64, hashB64] = guardado.split("$");
  if (alg !== "scrypt" || !salB64 || !hashB64) return false;
  const esperado = Buffer.from(hashB64, "base64");
  const calculado = await scrypt(senha, Buffer.from(salB64, "base64"), esperado.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}

/** Hash que dá o mesmo custo de uma senha real (evita revelar se o e-mail existe pelo tempo de resposta). */
let hashFalso: Promise<string> | null = null;
export const hashParaComparacaoFalsa = () => (hashFalso ??= gerarHashSenha(randomBytes(12).toString("hex")));

export const gerarToken = () => randomBytes(32).toString("base64url");

/** Senha provisória legível: sem caracteres ambíguos (0/O, 1/l/I). Ex.: "Kp7m-Rt4x-Hw9c" */
export function gerarSenhaProvisoria() {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bloco = () => Array.from({ length: 4 }, () => letras[randomInt(letras.length)]).join("");
  return `${bloco()}-${bloco()}-${bloco()}`;
}

export function validarForcaSenha(senha: string): string | null {
  if (senha.length < 8) return "A senha precisa ter pelo menos 8 caracteres.";
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return "A senha precisa ter letras e números.";
  return null;
}

// ---------------------------------------------------------------------
// Limite de tentativas de login (em memória, por e-mail e por IP)
// ---------------------------------------------------------------------
const MAX_ERROS = 5;
const BLOQUEIO_MS = 5 * 60_000;
const tentativas = new Map<string, { erros: number; ate: number }>();

export function minutosBloqueado(chaves: string[]) {
  const agora = Date.now();
  let resta = 0;
  for (const k of chaves) {
    const t = tentativas.get(k);
    if (t && t.ate > agora) resta = Math.max(resta, t.ate - agora);
  }
  return Math.ceil(resta / 60_000);
}

export function registrarErro(chaves: string[]) {
  const agora = Date.now();
  for (const k of chaves) {
    const t = tentativas.get(k) ?? { erros: 0, ate: 0 };
    if (t.ate && t.ate <= agora) t.erros = 0;
    t.erros += 1;
    t.ate = t.erros >= MAX_ERROS ? agora + BLOQUEIO_MS : 0;
    tentativas.set(k, t);
  }
}

export function limparErros(chaves: string[]) {
  for (const k of chaves) tentativas.delete(k);
}
