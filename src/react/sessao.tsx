/**
 * Sessão no React: usuário logado, pode(), entrar, sair, trocar senha e volta ao login quando a sessão expira.
 * Não depende de biblioteca de cache: o módulo recebe aoMudarUsuario para limpar o que for dele.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { pode as podeKit } from "../permissoes.js";
import type { criarClienteApi } from "../web.js";

type ClienteApi = ReturnType<typeof criarClienteApi>;

/** O mínimo que as peças de tela leem do usuário (o /api/eu do kit devolve isso e mais). */
export interface UsuarioTela {
  id: string;
  nome: string;
  email: string;
  tipo: "interno" | "externo";
  administrador?: boolean;
  precisa_trocar_senha?: boolean;
  perfil_nome?: string | null;
  permissoes?: readonly string[];
}

export interface Sessao<U extends UsuarioTela = UsuarioTela> {
  /** cliente de API do módulo (mesmo prefixo e cookie) */
  cliente: ClienteApi;
  usuario: U | null;
  /** true enquanto ainda não se sabe se há sessão aberta */
  carregando: boolean;
  entrar: (email: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
  /** relê o usuário (ex.: depois de trocar a senha provisória) */
  recarregar: () => Promise<void>;
  trocarSenha: (senhaAtual: string, novaSenha: string) => Promise<void>;
  pode: (chave: string) => boolean;
}
const SessaoCtx = createContext<Sessao<any> | null>(null);

export interface PropsProvedorSessao<U extends UsuarioTela> {
  cliente: ClienteApi;
  children: ReactNode;
  /** chamado no login, na saída e quando a sessão expira (ex.: limpar caches do módulo) */
  aoMudarUsuario?: () => void;
  /** evento de window disparado quando a API responde 401 (o mesmo do aoExpirarSessao do cliente) */
  eventoSessaoExpirada?: string;
  /** usuário definido fora do login (ex.: modo de testes com seletor): não consulta /api/eu */
  fixo?: { usuario: U | null; carregando: boolean };
  /** para onde ir depois de entrar ou sair (padrão "/") */
  inicio?: string;
}

export function ProvedorSessao<U extends UsuarioTela = UsuarioTela>({
  cliente,
  children,
  aoMudarUsuario,
  eventoSessaoExpirada = "plataforma:sessao-expirada",
  fixo,
  inicio = "/",
}: PropsProvedorSessao<U>) {
  const nav = useNavigate();
  const [usuario, setUsuario] = useState<U | null>(null);
  const [carregando, setCarregando] = useState(!fixo);

  const lerEu = useCallback(
    () => cliente.get<U>("/eu").catch((e: any) => (e?.status === 401 ? null : Promise.reject(e))),
    [cliente],
  );

  useEffect(() => {
    if (fixo) return;
    let vivo = true;
    lerEu()
      .then((u) => vivo && setUsuario(u))
      .catch(() => vivo && setUsuario(null))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [fixo, lerEu]);

  // sessão expirada em qualquer chamada: volta para o login
  useEffect(() => {
    if (fixo) return;
    const expirou = () => {
      setUsuario(null);
      aoMudarUsuario?.();
    };
    window.addEventListener(eventoSessaoExpirada, expirou);
    return () => window.removeEventListener(eventoSessaoExpirada, expirou);
  }, [fixo, eventoSessaoExpirada, aoMudarUsuario]);

  const entrar = useCallback(
    async (email: string, senha: string) => {
      const u = await cliente.post<U>("/auth/entrar", { email, senha });
      aoMudarUsuario?.();
      setUsuario(u);
      nav(inicio);
    },
    [cliente, aoMudarUsuario, nav, inicio],
  );
  const sair = useCallback(async () => {
    await cliente.post("/auth/sair", {}).catch(() => {});
    aoMudarUsuario?.();
    setUsuario(null);
    nav(inicio);
  }, [cliente, aoMudarUsuario, nav, inicio]);
  const recarregar = useCallback(async () => {
    setUsuario(await lerEu());
  }, [lerEu]);
  const trocarSenha = useCallback(
    async (senha_atual: string, nova_senha: string) => {
      await cliente.post("/auth/trocar-senha", { senha_atual, nova_senha });
    },
    [cliente],
  );

  const atual = fixo ? fixo.usuario : usuario;
  const valor = useMemo<Sessao<U>>(
    () => ({
      cliente,
      usuario: atual,
      carregando: fixo ? fixo.carregando : carregando,
      entrar,
      sair,
      recarregar,
      trocarSenha,
      pode: (chave: string) => podeKit(atual, chave),
    }),
    [cliente, atual, fixo, carregando, entrar, sair, recarregar, trocarSenha],
  );
  return <SessaoCtx.Provider value={valor}>{children}</SessaoCtx.Provider>;
}

export function useSessao<U extends UsuarioTela = UsuarioTela>(): Sessao<U> {
  const c = useContext(SessaoCtx);
  if (!c) throw new Error("useSessao precisa estar dentro de <ProvedorSessao>.");
  return c;
}
