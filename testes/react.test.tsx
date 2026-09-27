// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Casca,
  Modal,
  ProvedorAvisos,
  ProvedorSessao,
  TelaLogin,
  TelaTrocaSenha,
  useAvisos,
  useSessao,
  type UsuarioTela,
} from "../src/react/index.js";
import { ErroRequisicao } from "../src/web.js";

afterEach(cleanup);
const ANA: UsuarioTela = {
  id: "1",
  nome: "Ana Souza",
  email: "ana@x.com",
  tipo: "interno",
  administrador: true,
  perfil_nome: "Projetos",
  permissoes: ["mod.ver"],
};

/** Cliente de API falso: respostas por "MÉTODO caminho". */
function clienteFalso(respostas: Record<string, (corpo?: any) => any>) {
  const chamar = vi.fn(async (metodo: string, url: string, corpo?: unknown) => {
    const r = respostas[`${metodo} ${url}`];
    if (!r) throw new ErroRequisicao(404, `sem resposta para ${metodo} ${url}`);
    return r(corpo);
  });
  return {
    chamar,
    cliente: {
      requisitar: chamar as any,
      get: (u: string) => chamar("GET", u),
      post: (u: string, c?: unknown) => chamar("POST", u, c ?? {}),
      put: (u: string, c?: unknown) => chamar("PUT", u, c ?? {}),
      patch: (u: string, c?: unknown) => chamar("PATCH", u, c ?? {}),
      delete: (u: string) => chamar("DELETE", u),
    } as any,
  };
}
const Local = () => <span data-testid="local">{useLocation().pathname}</span>;
function montar(
  ui: React.ReactNode,
  cliente: any,
  extra: Partial<React.ComponentProps<typeof ProvedorSessao>> = {},
  inicial = "/tela",
) {
  return render(
    <MemoryRouter initialEntries={[inicial]}>
      <ProvedorAvisos>
        <ProvedorSessao cliente={cliente} {...extra}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  {ui}
                  <Local />
                </>
              }
            />
          </Routes>
        </ProvedorSessao>
      </ProvedorAvisos>
    </MemoryRouter>,
  );
}
const Quem = () => {
  const s = useSessao();
  return (
    <p data-testid="quem">
      {s.carregando ? "carregando" : (s.usuario?.nome ?? "ninguém")} {String(s.pode("mod.ver"))}
    </p>
  );
};

describe("ProvedorSessao", () => {
  it("carrega /eu; 401 vira 'ninguém'", async () => {
    const f = clienteFalso({
      "GET /eu": () => {
        throw new ErroRequisicao(401, "x");
      },
    });
    montar(<Quem />, f.cliente);
    expect(screen.getByTestId("quem").textContent).toBe("carregando false");
    await waitFor(() => expect(screen.getByTestId("quem").textContent).toBe("ninguém false"));
  });
  it("entrar grava o usuário, avisa o módulo e vai para o início; sair faz o inverso", async () => {
    const aoMudar = vi.fn();
    const f = clienteFalso({
      "GET /eu": () => null,
      "POST /auth/entrar": () => ANA,
      "POST /auth/sair": () => ({ ok: true }),
    });
    const Botoes = () => {
      const s = useSessao();
      return (
        <>
          <button onClick={() => s.entrar("ana@x.com", "s")}>entrar</button>
          <button onClick={() => s.sair()}>sair</button>
        </>
      );
    };
    montar(
      <>
        <Quem />
        <Botoes />
      </>,
      f.cliente,
      { aoMudarUsuario: aoMudar },
    );
    await waitFor(() => expect(screen.getByTestId("quem").textContent).toBe("ninguém false"));
    await act(async () => fireEvent.click(screen.getByText("entrar")));
    expect(screen.getByTestId("quem").textContent).toBe("Ana Souza true");
    expect(screen.getByTestId("local").textContent).toBe("/");
    expect(f.chamar).toHaveBeenCalledWith("POST", "/auth/entrar", { email: "ana@x.com", senha: "s" });
    await act(async () => fireEvent.click(screen.getByText("sair")));
    expect(screen.getByTestId("quem").textContent).toBe("ninguém false");
    expect(aoMudar).toHaveBeenCalledTimes(2);
  });
  it("evento de sessão expirada volta para o login", async () => {
    const aoMudar = vi.fn();
    const f = clienteFalso({ "GET /eu": () => ANA });
    montar(<Quem />, f.cliente, { aoMudarUsuario: aoMudar, eventoSessaoExpirada: "mod:expirou" });
    await waitFor(() => expect(screen.getByTestId("quem").textContent).toBe("Ana Souza true"));
    act(() => {
      window.dispatchEvent(new Event("mod:expirou"));
    });
    expect(screen.getByTestId("quem").textContent).toBe("ninguém false");
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });
  it("usuário fixo (modo de testes) não consulta /eu", () => {
    const f = clienteFalso({});
    montar(<Quem />, f.cliente, { fixo: { usuario: ANA, carregando: false } });
    expect(screen.getByTestId("quem").textContent).toBe("Ana Souza true");
    expect(f.chamar).not.toHaveBeenCalled();
  });
});

describe("TelaLogin", () => {
  const status = {
    version: "2.0.0",
    buildDate: "2026-09-27",
    acesso_teste: { senha: "teste123", emails: [{ email: "bruno@x.com", perfil: "Projetos" }] },
  };
  it("mostra nome, versão e caixa de testes; clicar preenche; erro da API aparece", async () => {
    const f = clienteFalso({
      "GET /eu": () => null,
      "POST /auth/entrar": () => {
        throw new ErroRequisicao(401, "E-mail ou senha incorretos.");
      },
    });
    montar(<TelaLogin subtitulo="Plataforma X" status={status} marca={<span className="marca-x" />} />, f.cliente);
    expect(screen.getByRole("heading", { name: "Entrar" })).toBeTruthy();
    expect(screen.getByText("Plataforma X")).toBeTruthy();
    expect(screen.getByText("v2.0.0 · 27/09/2026")).toBeTruthy();
    fireEvent.click(screen.getByText("bruno@x.com"));
    expect((screen.getByLabelText("E-mail") as HTMLInputElement).value).toBe("bruno@x.com");
    expect((screen.getByLabelText("Senha") as HTMLInputElement).value).toBe("teste123");
    await act(async () => fireEvent.submit(screen.getByRole("button", { name: "Entrar" }).closest("form")!));
    expect(screen.getByRole("alert").textContent).toBe("E-mail ou senha incorretos.");
  });
  it("mensagem de limite de tentativas; aviso de falta de administrador; busca o status sozinha", async () => {
    const f = clienteFalso({
      "GET /eu": () => null,
      "POST /auth/entrar": () => {
        throw new ErroRequisicao(429, "Muitas tentativas erradas. Tente de novo em 5 minutos.");
      },
    });
    const buscar = vi.fn(async () => ({ version: "1.0.0", buildDate: "2026-01-02", sem_administrador: true }));
    montar(<TelaLogin subtitulo="X" buscarStatus={buscar} />, f.cliente);
    await waitFor(() => expect(screen.getByText(/Nenhum administrador cadastrado/)).toBeTruthy());
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "a@x.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "x" } });
    await act(async () => fireEvent.submit(screen.getByLabelText("E-mail").closest("form")!));
    expect(screen.getByRole("alert").textContent).toMatch(/Muitas tentativas/);
  });
});

describe("TelaTrocaSenha", () => {
  it("confere a confirmação, troca a senha e relê o usuário", async () => {
    const f = clienteFalso({
      "GET /eu": () => ({ ...ANA, precisa_trocar_senha: true }),
      "POST /auth/trocar-senha": () => ({ ok: true }),
    });
    montar(<TelaTrocaSenha />, f.cliente);
    await waitFor(() => expect(screen.getByText(/Olá, Ana!/)).toBeTruthy());
    const [atual, nova, confirma] = [/^Senha provisória/, /^Nova senha/, /^Confirme a nova senha/].map((r) =>
      screen.getByLabelText(r),
    );
    fireEvent.change(atual, { target: { value: "prov1234" } });
    fireEvent.change(nova, { target: { value: "Nova12345" } });
    fireEvent.change(confirma, { target: { value: "Outra123" } });
    await act(async () => fireEvent.submit(atual.closest("form")!));
    expect(screen.getByRole("alert").textContent).toBe("A confirmação não confere com a nova senha.");
    fireEvent.change(confirma, { target: { value: "Nova12345" } });
    await act(async () => fireEvent.submit(atual.closest("form")!));
    expect(f.chamar).toHaveBeenCalledWith("POST", "/auth/trocar-senha", {
      senha_atual: "prov1234",
      nova_senha: "Nova12345",
    });
    expect(f.chamar.mock.calls.filter((c) => c[1] === "/eu")).toHaveLength(2);
  });
});

describe("Casca", () => {
  const props = { nome: "Orçamentos", versao: "2.0.0", data: "2026-09-27", embutido: false };
  it("nome, versão, abas e menu do usuário com itens do módulo (admin), trocar senha e sair", async () => {
    const f = clienteFalso({ "GET /eu": () => ANA, "POST /auth/sair": () => ({ ok: true }) });
    montar(
      <Casca
        {...props}
        abas={<nav>ABAS</nav>}
        itensMenu={[{ rotulo: "Usuários", caminho: "/usuarios", somenteAdministrador: true }]}
      />,
      f.cliente,
    );
    expect(screen.getByText("Orçamentos").closest("a")!.getAttribute("href")).toBe("/");
    expect(screen.getByText("v2.0.0 · 27/09/2026")).toBeTruthy();
    expect(screen.getByText("ABAS")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Ana Souza/ }));
    expect(screen.getByText("Projetos, administrador")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /Usuários/ }));
    expect(screen.getByTestId("local").textContent).toBe("/usuarios");
    fireEvent.click(screen.getByRole("button", { name: /Ana Souza/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Trocar senha/ }));
    expect(screen.getByRole("dialog", { name: "Trocar senha" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Ana Souza/ }));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: /Sair/ })));
    expect(f.chamar).toHaveBeenCalledWith("POST", "/auth/sair", {});
  });
  it("item só de administrador some para quem não é; dentro do portal a casca não aparece", async () => {
    const f = clienteFalso({ "GET /eu": () => ({ ...ANA, administrador: false }) });
    const { unmount } = montar(
      <Casca {...props} itensMenu={[{ rotulo: "Usuários", caminho: "/usuarios", somenteAdministrador: true }]} />,
      f.cliente,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Ana Souza/ }));
    expect(screen.queryByRole("menuitem", { name: /Usuários/ })).toBeNull();
    unmount();
    const { container } = montar(<Casca {...props} embutido />, f.cliente);
    expect(container.querySelector(".topo")).toBeNull();
  });
});

describe("avisos e modal", () => {
  it("aviso rápido some sozinho; confirmar resolve com a escolha", async () => {
    vi.useFakeTimers();
    let avisos!: ReturnType<typeof useAvisos>;
    const Pega = () => ((avisos = useAvisos()), null);
    render(
      <ProvedorAvisos>
        <Pega />
      </ProvedorAvisos>,
    );
    act(() => avisos.avisar("Salvo."));
    expect(screen.getByText("Salvo.").className).toBe("aviso aviso-ok");
    act(() => avisos.erro(new Error("Falhou.")));
    expect(screen.getByText("Falhou.").className).toBe("aviso aviso-erro");
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.queryByText("Salvo.")).toBeNull();
    expect(screen.getByText("Falhou.")).toBeTruthy();
    vi.useRealTimers();
    let resposta: Promise<boolean>;
    act(() => {
      resposta = avisos.confirmar({ titulo: "Excluir?", acao: "Excluir", perigo: true });
    });
    expect(screen.getByRole("button", { name: "Excluir" }).className).toBe("botao botao-perigo");
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
    await expect(resposta!).resolves.toBe(true);
  });
  it("Modal fecha com Esc e clicando fora", () => {
    const fechar = vi.fn();
    render(
      <Modal titulo="Janela" aoFechar={fechar}>
        conteúdo
      </Modal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(document.querySelector(".fundo-modal")!);
    expect(fechar).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("dialog", { name: "Janela" }).style.width).toBe("520px");
  });
  it("useSessao/useAvisos fora do provedor explicam o erro", () => {
    const Sem = () => (useSessao(), null);
    expect(() => render(<Sem />)).toThrow(/ProvedorSessao/);
  });
});
