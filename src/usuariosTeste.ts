/**
 * Bancos antigos podem ter usuários de teste com a senha conhecida (criados quando o modo de teste
 * ligava sozinho). Sem modo de teste, o módulo chama esta auditoria ao iniciar:
 *  - em produção: apaga a senha deles e encerra as sessões (bloqueio);
 *  - nos demais ambientes: só avisa no log.
 */
import { conferirSenha } from "./seguranca.js";
import type { Banco } from "./tipos.js";

export interface OpcoesAuditoria {
  banco: Banco;
  /** e-mails dos usuários de teste do módulo */
  emails: string[];
  /** senha de teste conhecida */
  senha: string;
  producao: boolean;
  log: (msg: string) => void;
}

/** Devolve os e-mails que ainda entravam com a senha de teste. */
export async function auditarUsuariosDeTeste(o: OpcoesAuditoria) {
  const { rows } = await o.banco.query<{ id: string; email: string; senha_hash: string }>(
    "SELECT id, email, senha_hash FROM usuarios WHERE ativo AND senha_hash IS NOT NULL AND lower(email) = ANY($1::text[])",
    [o.emails.map((e) => e.toLowerCase())],
  );
  const comSenhaDeTeste: typeof rows = [];
  for (const u of rows) if (await conferirSenha(o.senha, u.senha_hash)) comSenhaDeTeste.push(u);
  if (!comSenhaDeTeste.length) return [];
  const lista = comSenhaDeTeste.map((u) => u.email).join(", ");
  if (o.producao) {
    const ids = comSenhaDeTeste.map((u) => u.id);
    await o.banco.query("UPDATE usuarios SET senha_hash = NULL WHERE id = ANY($1::uuid[])", [ids]);
    await o.banco.query("DELETE FROM sessoes WHERE usuario_id = ANY($1::uuid[])", [ids]);
    o.log(`SEGURANÇA: usuários de teste com a senha de teste BLOQUEADOS (senha apagada, sessões encerradas): ${lista}`);
  } else {
    o.log(`ATENÇÃO: usuários de teste ainda entram com a senha de teste (MODO_TESTE desligado): ${lista}`);
  }
  return comSenhaDeTeste.map((u) => u.email);
}
