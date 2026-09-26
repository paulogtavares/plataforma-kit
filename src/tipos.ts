/** Resultado de uma consulta (mesmo formato no PostgreSQL de verdade e no embutido). */
export interface Resultado<T = any> {
  rows: T[];
  rowCount: number;
}

/**
 * Acesso ao banco que o módulo entrega ao kit. O kit não abre conexão própria:
 * assim cada módulo decide onde estão os dados (PostgreSQL, PGlite no servidor ou no navegador).
 */
export interface Banco {
  query<T = any>(sql: string, params?: unknown[]): Promise<Resultado<T>>;
}

/** Banco com transação: `usuarioId` é informado ao banco (auditoria) antes de rodar `fn`. */
export interface BancoComTransacao extends Banco {
  tx<T>(usuarioId: string | null, fn: (c: Banco) => Promise<T>): Promise<T>;
}

/** Usuário logado, como o kit entrega a cada requisição. P = tipo das chaves de permissão do módulo. */
export interface UsuarioPlataforma<P extends string = string> {
  id: string;
  nome: string;
  email: string;
  tipo: "interno" | "externo";
  cliente_id: string | null;
  administrador: boolean;
  precisa_trocar_senha: boolean;
  perfil_id: string | null;
  perfil_nome: string | null;
  /** permissões do perfil (administrador recebe todas as do catálogo do módulo) */
  permissoes: P[];
}

/** O mínimo que o kit precisa de uma requisição (Fastify ou o roteador do modo navegador). */
export interface RequisicaoBasica {
  headers: Record<string, string | string[] | undefined>;
}
