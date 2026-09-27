import { afterEach, describe, expect, it, vi } from "vitest";
import { ErroRequisicao, aplicarTema, criarClienteApi, criarEmbutido, dentroDeIframe, lerBase } from "../src/web.js";

const doc = (href: string | null) =>
  ({ querySelector: () => (href === null ? null : { getAttribute: () => href }) }) as any;

describe("prefixo na tela", () => {
  it("lê o <base href> e recusa valores estranhos", () => {
    expect(lerBase(doc("/cronogramas/"))).toBe("/cronogramas/");
    expect(lerBase(doc("cronogramas"))).toBe("/cronogramas/");
    expect(lerBase(doc(null))).toBe("/");
    expect(lerBase(doc('/x"><script>'))).toBe("/");
  });
});

describe("cliente de API", () => {
  afterEach(() => vi.unstubAllGlobals());
  const resposta = (status: number, corpo: unknown) => ({ status, ok: status < 400, json: async () => corpo });

  it("monta o caminho com o prefixo e manda JSON com o cookie da sessão", async () => {
    const fetch = vi.fn(async () => resposta(200, { ok: 1 }));
    vi.stubGlobal("fetch", fetch);
    const c = criarClienteApi({ base: "/cronogramas/" });
    expect(await c.post("/projetos", { nome: "x" })).toEqual({ ok: 1 });
    expect(fetch).toHaveBeenCalledWith(
      "/cronogramas/api/projetos",
      expect.objectContaining({ method: "POST", credentials: "same-origin", body: '{"nome":"x"}' }),
    );
    await c.get("api/eu");
    expect(fetch).toHaveBeenLastCalledWith(
      "/cronogramas/api/eu",
      expect.objectContaining({ method: "GET", body: undefined }),
    );
  });
  it("erro da API com código; 401 fora do login avisa sessão expirada", async () => {
    const aoExpirar = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => resposta(401, { erro: "Sua sessão expirou.", codigo: "7F3A" })),
    );
    const c = criarClienteApi({ base: "/", aoExpirarSessao: aoExpirar });
    await expect(c.get("/projetos")).rejects.toMatchObject({
      status: 401,
      message: "Sua sessão expirou.",
      codigo: "7F3A",
    });
    expect(aoExpirar).toHaveBeenCalledTimes(1);
    await expect(c.post("/auth/entrar", {})).rejects.toBeInstanceOf(ErroRequisicao);
    expect(aoExpirar).toHaveBeenCalledTimes(1); // senha errada no login não é sessão expirada
  });
  it("sem conexão: status 0 com a mensagem do módulo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("failed");
      }),
    );
    await expect(criarClienteApi({ base: "/", semConexao: "Sem API." }).get("/x")).rejects.toMatchObject({
      status: 0,
      message: "Sem API.",
    });
  });
});

describe("modo embutido", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("detecta o iframe (e trata acesso bloqueado ao topo como iframe)", () => {
    const w: any = {};
    w.self = w;
    w.top = w;
    expect(dentroDeIframe(w)).toBe(false);
    expect(dentroDeIframe({ self: {}, top: {} } as any)).toBe(true);
    expect(
      dentroDeIframe({
        self: {},
        get top() {
          throw new Error("bloqueado");
        },
      } as any),
    ).toBe(true);
    expect(dentroDeIframe(undefined)).toBe(false);
  });
  it("tema: escuro, claro e sistema", () => {
    const raiz: any = { dataset: {} };
    aplicarTema("escuro", raiz);
    expect(raiz.dataset.theme).toBe("dark");
    aplicarTema("claro", raiz);
    expect(raiz.dataset.theme).toBe("light");
    aplicarTema("sistema", raiz);
    expect(raiz.dataset.theme).toBeUndefined();
  });
  it("mensagens ao portal só para a própria origem; ouve só a janela mãe da mesma origem", () => {
    const enviadas: unknown[][] = [];
    const ouvintes: Record<string, (e: any) => void> = {};
    const mae = { postMessage: (...a: unknown[]) => enviadas.push(a) };
    vi.stubGlobal("window", {
      parent: mae,
      location: { origin: "https://plataforma.com" },
      addEventListener: (_: string, f: any) => (ouvintes.message = f),
      removeEventListener: () => delete ouvintes.message,
    });
    vi.stubGlobal("document", { title: "Cronogramas" });
    const e = criarEmbutido({ modulo: "cronogramas", ativo: true });
    e.avisarRotaAlterada("/modelos", "/cronogramas/modelos");
    e.avisarSessaoExpirada();
    expect(enviadas).toEqual([
      [
        {
          tipo: "rota-alterada",
          modulo: "cronogramas",
          caminho: "/modelos",
          url: "/cronogramas/modelos",
          titulo: "Cronogramas",
        },
        "https://plataforma.com",
      ],
      [{ tipo: "sessao-expirada", modulo: "cronogramas" }, "https://plataforma.com"],
    ]);
    const navegar = vi.fn();
    const tema = vi.fn();
    const parar = e.ouvirPortal({ navegar, tema });
    const chega = (data: unknown, origin = "https://plataforma.com", source: unknown = mae) =>
      ouvintes.message({ data, origin, source });
    chega({ tipo: "navegar", caminho: "/implantacao" });
    chega({ tipo: "navegar", caminho: "//malicioso.com" });
    chega({ tipo: "navegar", caminho: "/x" }, "https://outro.com");
    chega({ tipo: "navegar", caminho: "/y" }, "https://plataforma.com", {});
    chega({ tipo: "tema", tema: "escuro" });
    chega({ tipo: "tema", tema: "roxo" });
    expect(navegar.mock.calls).toEqual([["/implantacao"]]);
    expect(tema.mock.calls).toEqual([["escuro"]]);
    parar();
    expect(ouvintes.message).toBeUndefined();
  });
  it("fora do iframe não envia nem ouve nada", () => {
    const e = criarEmbutido({ modulo: "cronogramas", ativo: false });
    expect(e.embutido).toBe(false);
    expect(() => e.avisarSessaoExpirada()).not.toThrow();
    expect(e.ouvirPortal({ navegar: () => {} })()).toBeUndefined();
  });
});
