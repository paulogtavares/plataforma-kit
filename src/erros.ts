/** Erro com status HTTP e mensagem para o usuário (vai direto para a tela). */
export class ErroApi extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ErroApi";
  }
}

export const naoEncontrado = (o = "Registro") => new ErroApi(404, `${o} não encontrado.`);
export const proibido = (m = "Você não tem permissão para esta ação.") => new ErroApi(403, m);

/** Restrições comuns a todos os módulos (tabelas de usuários e perfis). */
const RESTRICOES_COMUNS: Record<string, string> = {
  ux_usuarios_email: "Já existe um usuário com esse e-mail.",
  ck_admin_interno: "Só usuários da equipe interna podem ser administradores.",
};

/**
 * Converte erros do PostgreSQL em mensagens para o usuário.
 * `restricoes`: mensagens das constraints do módulo (nome da constraint -> texto).
 */
export function traduzirErroPg(
  e: any,
  restricoes: Record<string, string> = {},
  /** texto para uma CHECK sem mensagem própria (cada módulo fala da sua regra) */
  textoValorNaoPermitido = "Valor não permitido pelas regras do sistema.",
): ErroApi | null {
  if (!e || typeof e.code !== "string") return null;
  const texto = e.constraint && (restricoes[e.constraint] ?? RESTRICOES_COMUNS[e.constraint]);
  if (texto) return new ErroApi(400, texto);
  switch (e.code) {
    case "P0001": // RAISE EXCEPTION das funções
      return new ErroApi(400, e.message);
    case "22P02":
      return new ErroApi(400, "Identificador ou valor inválido.");
    case "23505":
      return new ErroApi(409, "Registro duplicado.");
    case "23503":
      return new ErroApi(400, "Referência inválida (registro relacionado não existe ou está em uso).");
    case "23514":
      return new ErroApi(400, textoValorNaoPermitido);
  }
  return null;
}
