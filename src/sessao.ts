/**
 * Quem está fazendo a requisição. Dois modos (AUTH_MODO):
 *   local  — login com e-mail e senha no próprio módulo; sessão num cookie HttpOnly.
 *   portal — o portal já autenticou e manda um token assinado no cabeçalho (ver portal.ts).
 * Não existe login por cabeçalho com id de usuário: isso fica só no modo navegador de cada módulo.
 * Usa Web Crypto (sem node:crypto), então também roda no navegador.
 */
import { ErroApi } from "./erros.js";
import { verificarTokenPortal, type OpcoesPortal } from "./portal.js";
import type { Banco, RequisicaoBasica, UsuarioPlataforma } from "./tipos.js";

export type ModoAutenticacao = "local" | "portal";

export interface OpcoesSessao<P extends string = string> {
  banco: Banco;
  /** catálogo completo do módulo: é o que o administrador recebe */
  todasPermissoes: readonly P[];
  modo?: ModoAutenticacao;
  /** nome do cookie da sessão local (padrão "sessao"; cada módulo usa o seu) */
  nomeCookie?: string;
  /** obrigatório no modo portal */
  portal?: OpcoesPortal & { cabecalho?: string };
  /** registra o motivo técnico de recusas do portal (padrão: nada) */
  log?: (msg: string) => void;
}

/** SHA-256 em hexadecimal (o banco guarda só o hash do token da sessão). */
export async function hashToken(token: string) {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function lerCookie(req: RequisicaoBasica, nome: string) {
  const bruto = req.headers.cookie;
  const texto = Array.isArray(bruto) ? bruto.join(";") : bruto;
  if (!texto) return null;
  for (const parte of texto.split(";")) {
    const i = parte.indexOf("=");
    if (i > 0 && parte.slice(0, i).trim() === nome) {
      try {
        return decodeURIComponent(parte.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

const CAMPOS = `u.id, u.nome, u.email, u.tipo, u.cliente_id, u.administrador, u.precisa_trocar_senha,
  u.perfil_id, pf.nome AS perfil_nome, coalesce(pf.permissoes, '{}') AS permissoes`;
const JUNTAR_PERFIL = "LEFT JOIN perfis pf ON pf.id = u.perfil_id";

export function criarSessao<P extends string>(o: OpcoesSessao<P>) {
  type Usuario = UsuarioPlataforma<P>;
  const modo: ModoAutenticacao = o.modo ?? "local";
  const nomeCookie = o.nomeCookie ?? "sessao";
  if (modo === "portal" && !o.portal?.segredo)
    throw new Error("AUTH_MODO=portal exige o segredo do portal (PORTAL_SEGREDO).");
  const cabecalhoPortal = (o.portal?.cabecalho ?? "x-portal-token").toLowerCase();

  /** administrador: todas as permissões do módulo, independentemente do perfil */
  const completar = (u: Usuario): Usuario => (u.administrador ? { ...u, permissoes: [...o.todasPermissoes] } : u);

  async function carregarUsuario(id: string) {
    const { rows } = await o.banco.query<Usuario>(`SELECT ${CAMPOS} FROM usuarios u ${JUNTAR_PERFIL} WHERE u.id = $1`, [
      id,
    ]);
    return rows[0] ? completar(rows[0]) : null;
  }

  async function porPortal(req: RequisicaoBasica): Promise<Usuario> {
    const bruto = req.headers[cabecalhoPortal];
    const token = Array.isArray(bruto) ? bruto[0] : bruto;
    if (!token) throw new ErroApi(401, "Acesse pelo portal para continuar.");
    let email: string;
    try {
      email = (await verificarTokenPortal(token, o.portal!)).email;
    } catch (e: any) {
      o.log?.(`[portal] token recusado: ${e?.motivo ?? e?.message}`);
      throw e;
    }
    const { rows } = await o.banco.query<Usuario>(
      `SELECT ${CAMPOS} FROM usuarios u ${JUNTAR_PERFIL} WHERE lower(u.email) = $1 AND u.ativo`,
      [email],
    );
    if (!rows[0]) throw new ErroApi(403, "Seu usuário não tem acesso a este módulo. Fale com o administrador.");
    // quem entra pelo portal não tem senha local para trocar
    return completar({ ...rows[0], precisa_trocar_senha: false });
  }

  async function porCookie(req: RequisicaoBasica, permitirTrocaPendente: boolean): Promise<Usuario> {
    const token = lerCookie(req, nomeCookie);
    if (!token) throw new ErroApi(401, "Faça login para continuar.");
    const hash = await hashToken(token);
    const { rows } = await o.banco.query<Usuario & { renovar: boolean }>(
      `SELECT ${CAMPOS}, (s.expira_em < now() + interval '6 days') AS renovar
         FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id ${JUNTAR_PERFIL}
        WHERE s.token_hash = $1 AND s.expira_em > now() AND u.ativo`,
      [hash],
    );
    const u = rows[0];
    if (!u) throw new ErroApi(401, "Sua sessão expirou. Faça login novamente.");
    // sessão "deslizante": quem usa o sistema não precisa logar de novo toda semana
    if (u.renovar)
      await o.banco.query("UPDATE sessoes SET expira_em = now() + interval '7 days' WHERE token_hash = $1", [hash]);
    const { renovar: _r, ...usuario } = u;
    if (usuario.precisa_trocar_senha && !permitirTrocaPendente)
      throw new ErroApi(403, "Troque a senha provisória para continuar.");
    return completar(usuario as Usuario);
  }

  /** Identifica o usuário da requisição. Lança 401 (sem sessão) ou 403 (troca de senha pendente). */
  function autenticar(req: RequisicaoBasica, opcoes: { permitirTrocaPendente?: boolean } = {}) {
    return modo === "portal" ? porPortal(req) : porCookie(req, !!opcoes.permitirTrocaPendente);
  }

  return { modo, nomeCookie, autenticar, carregarUsuario };
}

export type Sessao<P extends string = string> = ReturnType<typeof criarSessao<P>>;
