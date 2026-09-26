/**
 * Permissões: regra de nomes, catálogo do módulo e a checagem pode().
 *
 * REGRA DE NOMES (kit v1): toda chave começa com o identificador do módulo e um ponto,
 * seguido de um ou mais segmentos em minúsculas, números ou "_", separados por ponto.
 *     cronogramas.criar
 *     cronogramas.modelos.gerenciar
 *     orcamentos.aprovar
 * Assim o portal junta os perfis de vários módulos sem colisão, e cada módulo só
 * reconhece as próprias chaves.
 */
import { proibido } from "./erros.js";

const SEGMENTO = "[a-z][a-z0-9_]*";
const CHAVE = new RegExp(`^${SEGMENTO}(\\.${SEGMENTO})+$`);
const MODULO = new RegExp(`^${SEGMENTO}$`);

/** A chave segue a regra e pertence ao módulo? */
export function chaveDoModulo(modulo: string, chave: string) {
  return MODULO.test(modulo) && CHAVE.test(chave) && chave.startsWith(`${modulo}.`);
}

/**
 * Coloca o prefixo do módulo numa chave antiga. Idempotente: chave que já começa com
 * "<modulo>." fica como está (ex.: "cronogramas.criar" não vira "cronogramas.cronogramas.criar").
 */
export function prefixar(modulo: string, chave: string) {
  return chave.startsWith(`${modulo}.`) ? chave : `${modulo}.${chave}`;
}

export interface ItemCatalogo<C extends string = string> {
  chave: C;
  grupo: string;
  nome: string;
  descricao: string;
}

/**
 * Catálogo de permissões de um módulo. Recusa (ao iniciar) chaves fora da regra ou repetidas,
 * para o erro aparecer no desenvolvimento e não em produção.
 */
export function criarCatalogo<const L extends readonly ItemCatalogo[]>(modulo: string, lista: L) {
  const vistas = new Set<string>();
  for (const p of lista) {
    if (!chaveDoModulo(modulo, p.chave))
      throw new Error(`Permissão "${p.chave}" fora da regra do kit: use "${modulo}.<recurso>[.<ação>]".`);
    if (vistas.has(p.chave)) throw new Error(`Permissão "${p.chave}" repetida no catálogo.`);
    vistas.add(p.chave);
  }
  type Chave = L[number]["chave"];
  const todas = lista.map((p) => p.chave) as Chave[];
  return {
    modulo,
    lista,
    todas,
    valida: (c: string): c is Chave => vistas.has(c),
  };
}

/** A pessoa tem a permissão? Administrador tem todas. Serve no servidor e na tela. */
export function pode(u: { administrador?: boolean; permissoes?: readonly string[] } | null | undefined, chave: string) {
  return !!u && (!!u.administrador || !!u.permissoes?.includes(chave));
}

export function exigirAdministrador(u: { administrador?: boolean } | null | undefined) {
  if (!u?.administrador) throw proibido("Apenas administradores podem fazer isso.");
}
