// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProvedorAvisos, ProvedorSessao, TelaUsuarios, type ExtensaoUsuario, type UsuarioTela } from "../src/react/index.js";
import { ErroRequisicao } from "../src/web.js";

afterEach(cleanup);
const ADMIN: UsuarioTela = { id: "u1", nome: "Ana Souza", email: "ana@x.com", tipo: "interno", administrador: true };
const PERFIS = [
  { id: "p1", nome: "Equipe", descricao: "Interna", permissoes: ["mod.ver", "mod.interna"], qtd_usuarios: 1 },
  { id: "p2", nome: "Cliente", descricao: null, permissoes: [], qtd_usuarios: 1 },
];
const USUARIOS = [
  { id: "u1", nome: "Ana Souza", email: "ana@x.com", tipo: "interno", cliente_id: null, ativo: true, administrador: true, precisa_trocar_senha: false, ultimo_acesso: null, criado_em: "", tem_senha: true, perfil_id: "p1", perfil_nome: "Equipe", cliente_nome: null },
  { id: "u2", nome: "Carla", email: "carla@lume.com", tipo: "externo", cliente_id: "c1", ativo: true, administrador: false, precisa_trocar_senha: true, ultimo_acesso: null, criado_em: "", tem_senha: true, perfil_id: "p2", perfil_nome: "Cliente", cliente_nome: "Lume" },
];
const CATALOGO = [
  { chave: "mod.ver", grupo: "Geral", nome: "Ver tudo", descricao: "d1" },
  { chave: "mod.interna", grupo: "Geral", nome: "Ver itens internos", descricao: "d2" },
];

function montar(props: Partial<React.ComponentProps<typeof TelaUsuarios>> = {}, usuario: UsuarioTela = ADMIN) {
  const chamar = vi.fn(async (metodo: string, url: string, corpo?: any): Promise<any> => {
    const k = `${metodo} ${url}`;
    if (k === "GET /admin/usuarios") return USUARIOS;
    if (k === "GET /admin/perfis") return PERFIS;
    if (k === "GET /admin/permissoes") return CATALOGO;
    if (k === "POST /admin/usuarios") return { id: "u9", senha_provisoria: "Prov-1234" };
    if (metodo === "PATCH" || metodo === "PUT" || metodo === "DELETE" || url.endsWith("/redefinir-senha")) return { ok: true, senha_provisoria: "Nova-5678" };
    throw new ErroRequisicao(404, k);
  });
  const cliente: any = { requisitar: chamar, get: (u: string) => chamar("GET", u), post: (u: string, c?: any) => chamar("POST", u, c ?? {}), put: (u: string, c?: any) => chamar("PUT", u, c ?? {}), patch: (u: string, c?: any) => chamar("PATCH", u, c ?? {}), delete: (u: string) => chamar("DELETE", u) };
  render(
    <MemoryRouter initialEntries={["/usuarios"]}>
      <ProvedorAvisos>
        <ProvedorSessao cliente={cliente} fixo={{ usuario, carregando: false }}>
          <Routes>
            <Route path="/usuarios" element={<TelaUsuarios permissaoInterna="mod.interna" {...props} />} />
            <Route path="/" element={<p>início</p>} />
          </Routes>
        </ProvedorSessao>
      </ProvedorAvisos>
    </MemoryRouter>,
  );
  return chamar;
}

describe("TelaUsuarios", () => {
  it("lista usuários com situação, marca 'você' e mostra as extensões do módulo", async () => {
    montar({
      acoesCabecalho: <button>Backup</button>,
      complementoPerfil: (u) => (u.cliente_nome ? ` (${u.cliente_nome})` : ""),
      detalheUsuario: (u) => u.tipo === "externo" && <span>itens liberados</span>,
    });
    expect(await screen.findByText("Ana Souza (você)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Backup" })).toBeTruthy();
    const carla = screen.getByText("Carla").closest(".linha-usuario") as HTMLElement;
    expect(within(carla).getByText("Aguardando 1º acesso")).toBeTruthy();
    expect(carla.textContent).toContain("Cliente (Lume)");
    expect(within(carla).getByText("itens liberados")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Usuários/ }).textContent).toBe("Usuários 2");
    // a própria pessoa não tem o botão de desativar
    const ana = screen.getByText("Ana Souza (você)").closest(".linha-usuario") as HTMLElement;
    expect(within(ana).queryByRole("button", { name: "Desativar" })).toBeNull();
  });

  it("busca pelo texto do módulo", async () => {
    montar({ placeholderBusca: "Buscar por nome, e-mail ou cliente", textoBusca: (u) => `${u.nome} ${u.cliente_nome ?? ""}` });
    await screen.findByText("Carla");
    fireEvent.change(screen.getByPlaceholderText("Buscar por nome, e-mail ou cliente"), { target: { value: "lume" } });
    expect(screen.queryByText("Ana Souza (você)")).toBeNull();
    expect(screen.getByText("Carla")).toBeTruthy();
  });

  it("quem não é administrador volta para o início", async () => {
    montar({}, { ...ADMIN, administrador: false });
    expect(await screen.findByText("início")).toBeTruthy();
  });

  it("novo usuário: envia os dados da extensão, chama depoisDeSalvar e mostra a senha provisória uma vez", async () => {
    const depois = vi.fn(async () => {});
    const extensao: ExtensaoUsuario<any, { extra: string }> = {
      inicial: () => ({ extra: "x1" }),
      Campos: ({ externo }) => <p>campos extras {externo ? "externo" : "interno"}</p>,
      dados: (v, externo) => ({ cliente_id: externo ? v.extra : null }),
      depoisDeSalvar: depois,
    };
    const chamar = montar({ extensao, nomePlataforma: "plataforma de orçamentos", textoAdministrador: "Admin do módulo" });
    await screen.findByText("Carla");
    fireEvent.click(screen.getByRole("button", { name: /Novo usuário/ }));
    const dialogo = screen.getByRole("dialog", { name: "Novo usuário" });
    fireEvent.change(within(dialogo).getByLabelText("Nome"), { target: { value: "Dora Lima" } });
    fireEvent.change(within(dialogo).getByLabelText("E-mail (usado no login)"), { target: { value: "dora@x.com" } });
    fireEvent.click(within(dialogo).getByLabelText(/Equipe/));
    expect(within(dialogo).getByText("Admin do módulo")).toBeTruthy();
    expect(within(dialogo).getByText("campos extras interno")).toBeTruthy();
    fireEvent.click(within(dialogo).getByLabelText(/^Cliente/));
    expect(within(dialogo).queryByText("Admin do módulo")).toBeNull(); // perfil externo não pode ser administrador
    expect(within(dialogo).getByText("campos extras externo")).toBeTruthy();
    await act(async () => fireEvent.submit(within(dialogo).getByLabelText("Nome").closest("form")!));
    expect(chamar).toHaveBeenCalledWith("POST", "/admin/usuarios", { nome: "Dora Lima", email: "dora@x.com", perfil_id: "p2", cliente_id: "x1", administrador: false });
    expect(depois).toHaveBeenCalledWith("u9", { extra: "x1" }, null);
    const senha = screen.getByRole("dialog", { name: "Senha provisória gerada" });
    expect(within(senha).getByText("Prov-1234")).toBeTruthy();
    expect((within(senha).getByRole("textbox") as HTMLTextAreaElement).value).toMatch(/^Olá, Dora! Seu acesso à plataforma de orçamentos:/);
  });

  it("editar o próprio usuário não envia administrador nem dados extras", async () => {
    const chamar = montar({ extensao: { inicial: () => ({}), Campos: () => null, dados: () => ({ cliente_id: null }) } });
    const ana = (await screen.findByText("Ana Souza (você)")).closest(".linha-usuario") as HTMLElement;
    fireEvent.click(within(ana).getByRole("button", { name: "Editar" }));
    const dialogo = screen.getByRole("dialog", { name: "Editar Ana Souza" });
    expect((within(dialogo).getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    await act(async () => fireEvent.submit(within(dialogo).getByLabelText("Nome").closest("form")!));
    expect(chamar).toHaveBeenCalledWith("PATCH", "/admin/usuarios/u1", { nome: "Ana Souza", email: "ana@x.com", perfil_id: "p1" });
  });

  it("desativar pede confirmação e usa a rota do kit", async () => {
    const chamar = montar();
    const carla = (await screen.findByText("Carla")).closest(".linha-usuario") as HTMLElement;
    fireEvent.click(within(carla).getByRole("button", { name: "Desativar" }));
    await act(async () => fireEvent.click(within(screen.getByRole("dialog", { name: "Desativar Carla?" })).getByRole("button", { name: "Desativar" })));
    expect(chamar).toHaveBeenCalledWith("PATCH", "/admin/usuarios/u2", { ativo: false });
    await waitFor(() => expect(screen.getByText("Usuário desativado.")).toBeTruthy());
  });

  it("perfis: nomes do catálogo, texto do perfil vazio e aviso sem a permissão interna", async () => {
    const chamar = montar({ textoPerfilVazio: "Só vê o que for liberado", avisoSemInterna: <>Sem a permissão interna, visão externa.</> });
    await screen.findByText("Carla");
    fireEvent.click(screen.getByRole("tab", { name: "Perfis de acesso" }));
    expect(await screen.findByText("Ver itens internos")).toBeTruthy();
    expect(screen.getByText("Só vê o que for liberado")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Novo perfil/ }));
    const dialogo = screen.getByRole("dialog", { name: "Novo perfil de acesso" });
    // perfil novo já nasce com a permissão interna marcada
    expect((within(dialogo).getByLabelText(/Ver itens internos/) as HTMLInputElement).checked).toBe(true);
    expect(within(dialogo).queryByText("Sem a permissão interna, visão externa.")).toBeNull();
    fireEvent.click(within(dialogo).getByLabelText(/Ver itens internos/));
    expect(within(dialogo).getByText("Sem a permissão interna, visão externa.")).toBeTruthy();
    fireEvent.change(within(dialogo).getByLabelText("Nome do perfil"), { target: { value: "Diretoria" } });
    fireEvent.click(within(dialogo).getByLabelText(/Ver tudo/));
    await act(async () => fireEvent.submit(within(dialogo).getByLabelText("Nome do perfil").closest("form")!));
    expect(chamar).toHaveBeenCalledWith("POST", "/admin/perfis", { nome: "Diretoria", descricao: null, permissoes: ["mod.ver"] });
  });
});
