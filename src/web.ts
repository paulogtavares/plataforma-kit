/**
 * Peças de tela comuns (rodam no navegador):
 *  - prefixo: BASE / BASENAME lidos do <base href> que o servidor escreve (mesmo build em / e em /modulo/);
 *  - cliente de API: caminhos relativos ao prefixo, cookie da sessão, erro { erro, codigo }, aviso de sessão expirada;
 *  - modo embutido: dentro do iframe do portal (mesma origem), troca de mensagens
 *      módulo -> portal: rota-alterada, sessao-expirada
 *      portal -> módulo: navegar, tema
 * Os estilos comuns ficam em "plataforma-kit/tokens.css".
 */

// ---------------------------------------------------------------- prefixo

/** Lê o prefixo do <base href> (padrão "/"); valores fora de letras, números e . _ ~ - / viram "/". */
export function lerBase(doc: Document | undefined = typeof document === "undefined" ? undefined : document) {
  const limpo = `/${doc?.querySelector("base")?.getAttribute("href") ?? "/"}/`.replace(/\/{2,}/g, "/");
  return /^[A-Za-z0-9._~\-/]+$/.test(limpo) ? limpo : "/";
}

/** Sempre começa e termina com "/": "/" ou "/cronogramas/" */
export const BASE = lerBase();
/** Para o basename do roteador: "/" ou "/cronogramas" (sem a barra final) */
export const BASENAME = BASE === "/" ? "/" : BASE.slice(0, -1);
/** Endereço completo da tela, para mandar a quem vai acessar: https://servidor/cronogramas/ */
export const enderecoTela = () => (typeof window === "undefined" ? BASE : window.location.origin + BASE);

// ---------------------------------------------------------------- cliente de API

/** Erro de uma chamada: status HTTP (0 = sem conexão), mensagem da API e código do log. */
export class ErroRequisicao extends Error {
  status: number;
  codigo?: string;
  constructor(status: number, mensagem: string, codigo?: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.name = "ErroRequisicao";
  }
}

export interface OpcoesCliente {
  /** prefixo (padrão: BASE) */
  base?: string;
  /** mensagem quando o servidor não responde */
  semConexao?: string;
  /** chamado quando a API responde 401 fora das rotas de login e de /eu (sessão que existia e expirou) */
  aoExpirarSessao?: () => void;
}

export function criarClienteApi(o: OpcoesCliente = {}) {
  const base = o.base ?? BASE;
  /** url: "/projetos" ou "projetos" (o "/api" é acrescentado) */
  async function requisitar<T = any>(metodo: string, url: string, corpo?: unknown): Promise<T> {
    const caminho = url.replace(/^\/+/, "").replace(/^api\//, "");
    const cabecalhos: Record<string, string> = {};
    if (corpo !== undefined) cabecalhos["Content-Type"] = "application/json";
    let r: Response;
    try {
      r = await fetch(`${base}api/${caminho}`, {
        method: metodo,
        headers: cabecalhos,
        credentials: "same-origin",
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    } catch {
      throw new ErroRequisicao(0, o.semConexao ?? "Sem conexão com o servidor.");
    }
    if (r.status === 204) return undefined as T;
    const dados: any = await r.json().catch(() => ({}));
    // 401 no login (auth/*) é senha errada, e em /eu é "ninguém logado ainda": nenhum dos dois é sessão expirada
    if (r.status === 401 && !caminho.startsWith("auth/") && caminho !== "eu") o.aoExpirarSessao?.();
    if (!r.ok) throw new ErroRequisicao(r.status, dados.erro ?? `Erro ${r.status}`, dados.codigo);
    return dados as T;
  }
  return {
    requisitar,
    get: <T = any>(url: string) => requisitar<T>("GET", url),
    post: <T = any>(url: string, corpo?: unknown) => requisitar<T>("POST", url, corpo ?? {}),
    put: <T = any>(url: string, corpo?: unknown) => requisitar<T>("PUT", url, corpo ?? {}),
    patch: <T = any>(url: string, corpo?: unknown) => requisitar<T>("PATCH", url, corpo ?? {}),
    delete: <T = any>(url: string) => requisitar<T>("DELETE", url),
  };
}

// ---------------------------------------------------------------- modo embutido

export function dentroDeIframe(w: Window | undefined = typeof window === "undefined" ? undefined : window) {
  if (!w) return false;
  try {
    return w.self !== w.top;
  } catch {
    return true; // acesso ao topo bloqueado: com certeza está num iframe
  }
}

export type Tema = "claro" | "escuro" | "sistema";

/** Aplica o tema pedido pelo portal: data-theme="dark"/"light" no <html>; "sistema" segue o sistema. */
export function aplicarTema(tema: Tema, raiz: HTMLElement = document.documentElement) {
  if (tema === "sistema") delete raiz.dataset.theme;
  else raiz.dataset.theme = tema === "escuro" ? "dark" : "light";
}

export interface OpcoesEmbutido {
  /** id do módulo, enviado em cada mensagem */
  modulo: string;
  /** força ligado/desligado (padrão: detecta o iframe) */
  ativo?: boolean;
}

export function criarEmbutido(o: OpcoesEmbutido) {
  const embutido = o.ativo ?? dentroDeIframe();
  // só para a própria origem: a mensagem nunca vai para outro site
  const enviar = (m: Record<string, unknown>) => {
    if (embutido) window.parent.postMessage(m, window.location.origin);
  };
  return {
    embutido,
    /** a cada navegação: o portal marca o item do menu e atualiza o endereço */
    avisarRotaAlterada: (caminho: string, url: string) =>
      enviar({ tipo: "rota-alterada", modulo: o.modulo, caminho, url, titulo: document.title }),
    /** a API respondeu 401: o portal decide (renovar o token, mandar para o login) */
    avisarSessaoExpirada: () => enviar({ tipo: "sessao-expirada", modulo: o.modulo }),
    /** Ouve o portal (só a mesma origem e só a janela mãe). Devolve a função que para de ouvir. */
    ouvirPortal(acoes: { navegar: (caminho: string) => void; tema?: (tema: Tema) => void }) {
      if (!embutido) return () => {};
      const aoReceber = (e: MessageEvent) => {
        if (e.origin !== window.location.origin || e.source !== window.parent) return;
        const m = e.data;
        if (
          m?.tipo === "navegar" &&
          typeof m.caminho === "string" &&
          m.caminho.startsWith("/") &&
          !m.caminho.startsWith("//")
        )
          acoes.navegar(m.caminho);
        else if (m?.tipo === "tema" && ["claro", "escuro", "sistema"].includes(m.tema))
          (acoes.tema ?? aplicarTema)(m.tema);
      };
      window.addEventListener("message", aoReceber);
      return () => window.removeEventListener("message", aoReceber);
    },
  };
}
