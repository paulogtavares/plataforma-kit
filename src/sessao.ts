/**
 * Quem está fazendo a requisição. Dois modos (AUTH_MODO):
 *   local  — login com e-mail e senha no próprio módulo; sessão num cookie HttpOnly.
 *   portal — o portal já autenticou e manda o token da plataforma em X-Plataforma-Token (ver portal.ts);
 *            o usuário local é criado ou atualizado pelo sub do token e as permissões vêm do token.
 * Não existe login por cabeçalho com id de usuário: isso fica só no modo navegador de cada módulo.
 * Usa Web Crypto (sem node:crypto), então também roda no navegador.
 */
import { ErroApi } from "./erros.js";
import { CABECALHO_TOKEN, verificarTokenPlataforma, type TokenPlataforma } from "./portal.js";
import type { Banco, RequisicaoBasica, UsuarioPlataforma } from "./tipos.js";

export type ModoAutenticacao = "local" | "portal";

export interface OpcoesSessao<P extends string = string> {
  banco: Banco;
  /** catálogo completo do módulo: é o que o administrador recebe */
  todasPermissoes: readonly P[];
  modo?: ModoAutenticacao;
  /** nome do cookie da sessão local (padrão "sessao"; cada módulo usa o seu) */
  nomeCookie?: string;
  /** id do módulo (aud do token); obrigatório no modo portal */
  modulo?: string;
  /** SEGREDO_PLATAFORMA; obrigatório no modo portal */
  segredoPlataforma?: string;
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
  if (modo === "portal" && !o.segredoPlataforma) throw new Error("AUTH_MODO=portal exige SEGREDO_PLATAFORMA.");
  if (modo === "portal" && !o.modulo) throw new Error("AUTH_MODO=portal exige o id do módulo (aud do token).");
  const catalogo = new Set<string>(o.todasPermissoes);

  /** administrador: todas as permissões do módulo, independentemente do perfil */
  const completar = (u: Usuario): Usuario => (u.administrador ? { ...u, permissoes: [...o.todasPermissoes] } : u);

  async function carregarUsuario(id: string) {
    const { rows } = await o.banco.query<Usuario>(`SELECT ${CAMPOS} FROM usuarios u ${JUNTAR_PERFIL} WHERE u.id = $1`, [
      id,
    ]);
    return rows[0] ? completar(rows[0]) : null;
  }

  /** Cria ou atualiza o usuário local pelo sub do token (fase 2 do contrato). */
  async function sincronizarUsuario(t: TokenPlataforma) {
    // administrador só vale para a equipe interna (mesma regra da constraint ck_admin_interno)
    const administrador = t.admin && t.tipo === "interno";
    if (t.admin && !administrador) o.log?.(`[portal] ${t.email}: admin ignorado para usuário externo`);
    const gravar = (clienteId: string | null) =>
      o.banco.query(
        `INSERT INTO usuarios (id, nome, email, tipo, cliente_id, administrador, ativo)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         ON CONFLICT (id) DO UPDATE
            SET nome = EXCLUDED.nome, email = EXCLUDED.email, tipo = EXCLUDED.tipo,
                cliente_id = EXCLUDED.cliente_id, administrador = EXCLUDED.administrador
          WHERE (usuarios.nome, usuarios.email, usuarios.tipo, usuarios.cliente_id, usuarios.administrador)
                IS DISTINCT FROM (EXCLUDED.nome, EXCLUDED.email, EXCLUDED.tipo, EXCLUDED.cliente_id, EXCLUDED.administrador)`,
        [t.sub, t.nome, t.email, t.tipo, clienteId, administrador],
      );
    try {
      await gravar(t.cliente_id);
    } catch (e: any) {
      if (e?.code === "23503" && t.cliente_id) {
        // o cliente do portal ainda não existe neste módulo: entra sem cliente
        o.log?.(`[portal] ${t.email}: cliente_id ${t.cliente_id} não existe neste módulo; gravado sem cliente`);
        await gravar(null);
      } else if (e?.code === "23505") {
        o.log?.(`[portal] ${t.email}: e-mail já usado por outro usuário local (id diferente de ${t.sub})`);
        throw new ErroApi(
          409,
          "Seu e-mail já está cadastrado neste módulo com outro usuário. Fale com o administrador.",
        );
      } else throw e;
    }
  }

  async function porPortal(req: RequisicaoBasica): Promise<Usuario> {
    const bruto = req.headers[CABECALHO_TOKEN];
    const token = Array.isArray(bruto) ? bruto[0] : bruto;
    if (!token) throw new ErroApi(401, "Acesse pelo portal para continuar.");
    let t: TokenPlataforma;
    try {
      t = await verificarTokenPlataforma(token, { segredo: o.segredoPlataforma!, modulo: o.modulo! });
    } catch (e: any) {
      o.log?.(`[portal] token recusado: ${e?.motivo ?? e?.message}`);
      throw e;
    }
    await sincronizarUsuario(t);
    const { rows } = await o.banco.query<Usuario & { ativo: boolean }>(
      `SELECT ${CAMPOS}, u.ativo FROM usuarios u ${JUNTAR_PERFIL} WHERE u.id = $1`,
      [t.sub],
    );
    const u = rows[0];
    // desativado pelo administrador do módulo: o portal não reativa
    if (!u?.ativo) throw new ErroApi(403, "Seu usuário está desativado neste módulo. Fale com o administrador.");
    const { ativo: _a, ...usuario } = u;
    // permissões do token, só as do catálogo deste módulo; quem entra pelo portal não tem senha local
    const permissoes = t.permissoes.filter((p) => catalogo.has(p)) as P[];
    return completar({ ...(usuario as Usuario), permissoes, precisa_trocar_senha: false });
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
