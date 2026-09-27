/**
 * Tela de usuários e perfis (modo local), montada a partir do catálogo de permissões do módulo.
 * Usa as rotas /api/admin/* do kit (rotasAdministracao). O que é de cada módulo entra por propriedades:
 * botões no cabeçalho, detalhes na linha do usuário e campos extras no formulário (ex.: cliente e acessos).
 */
import { useCallback, useEffect, useMemo, useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import { Navigate } from "react-router";
import { Copy, KeyRound, Plus, Search, ShieldCheck } from "lucide-react";
import type { ItemCatalogo } from "../permissoes.js";
import { enderecoTela } from "../web.js";
import { Campo, Modal, useAvisos } from "./avisos.js";
import { useSessao } from "./sessao.js";

export interface UsuarioAdmin {
  id: string;
  nome: string;
  email: string;
  tipo: "interno" | "externo";
  cliente_id: string | null;
  ativo: boolean;
  administrador: boolean;
  precisa_trocar_senha: boolean;
  ultimo_acesso: string | null;
  criado_em: string;
  tem_senha: boolean;
  perfil_id?: string | null;
  perfil_nome?: string | null;
  /** colunas extras do módulo (ex.: cliente_nome, acessos) */
  [extra: string]: unknown;
}
export interface PerfilAdmin {
  id: string;
  nome: string;
  descricao: string | null;
  permissoes: string[];
  qtd_usuarios: number;
}

/** Campos do módulo no formulário de usuário (ex.: cliente e cronogramas liberados no Cronogramas). */
export interface ExtensaoUsuario<U extends UsuarioAdmin = UsuarioAdmin, E = any> {
  /** estado inicial dos campos extras */
  inicial: (usuario: U | null) => E;
  /** renderizados depois da opção de administrador */
  Campos: ComponentType<{
    usuario: U | null;
    externo: boolean;
    perfil: PerfilAdmin | undefined;
    valor: E;
    mudar: (v: E) => void;
  }>;
  /** dados extras enviados ao criar ou editar (não vale na edição do próprio usuário) */
  dados?: (valor: E, externo: boolean) => Record<string, unknown>;
  /** depois de criar ou editar (ex.: gravar os acessos) */
  depoisDeSalvar?: (id: string, valor: E, usuario: U | null) => Promise<void>;
}

export interface PropsTelaUsuarios<U extends UsuarioAdmin = UsuarioAdmin> {
  /** permissão que define o usuário interno (a mesma do rotasAdministracao) */
  permissaoInterna?: string;
  /** botões extras no cabeçalho (ex.: exportar backup) */
  acoesCabecalho?: ReactNode;
  placeholderBusca?: string;
  /** texto usado na busca (padrão: nome e e-mail) */
  textoBusca?: (u: U) => string;
  /** depois do nome do perfil, na linha (ex.: " (Cliente X)") */
  complementoPerfil?: (u: U) => ReactNode;
  /** depois do selo de administrador, na linha (ex.: quantidade de itens liberados) */
  detalheUsuario?: (u: U) => ReactNode;
  /** texto da opção de administrador no formulário */
  textoAdministrador?: string;
  /** lista de permissões de um perfil vazio */
  textoPerfilVazio?: string;
  /** aviso no formulário de perfil quando a permissão interna está desmarcada */
  avisoSemInterna?: ReactNode;
  /** "Seu acesso à {nomePlataforma}:" na mensagem da senha provisória */
  nomePlataforma?: string;
  extensao?: ExtensaoUsuario<U>;
  /** para onde vai quem não é administrador (padrão "/") */
  inicio?: string;
}

export function dataHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Carrega uma lista da API e permite recarregar. */
function useLista<T>(url: string, ativo = true) {
  const { cliente } = useSessao();
  const [dados, setDados] = useState<T[]>([]);
  const [carregando, setCarregando] = useState(ativo);
  const recarregar = useCallback(async () => {
    try {
      setDados(await cliente.get<T[]>(url));
    } finally {
      setCarregando(false);
    }
  }, [cliente, url]);
  useEffect(() => {
    if (ativo) recarregar().catch(() => {});
  }, [ativo, recarregar]);
  return { dados, carregando, recarregar };
}

export function TelaUsuarios<U extends UsuarioAdmin = UsuarioAdmin>(p: PropsTelaUsuarios<U>) {
  const { usuario, cliente } = useSessao();
  const { erro, confirmar, avisar } = useAvisos();
  const admin = !!usuario?.administrador;
  const usuarios = useLista<U>("/admin/usuarios", admin);
  const perfis = useLista<PerfilAdmin>("/admin/perfis", admin);
  const [aba, setAba] = useState<"usuarios" | "perfis">("usuarios");
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<U | "novo" | null>(null);
  const [senha, setSenha] = useState<{ nome: string; email: string; senha: string } | null>(null);
  const data = usuarios.dados;
  const textoBusca = p.textoBusca ?? ((u: U) => `${u.nome} ${u.email}`);

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return data.filter((u) => !t || textoBusca(u).toLowerCase().includes(t));
  }, [data, busca, textoBusca]);

  if (!admin) return <Navigate to={p.inicio ?? "/"} replace />;
  const atualizar = () => usuarios.recarregar().catch(() => {});

  const redefinir = async (u: U) => {
    const ok = await confirmar({
      titulo: `Gerar nova senha para ${u.nome}?`,
      texto:
        "A senha atual deixa de funcionar e as sessões abertas dessa pessoa são encerradas. Ela precisará criar uma senha nova no próximo acesso.",
      acao: "Gerar senha provisória",
    });
    if (!ok) return;
    try {
      const r = await cliente.post<{ senha_provisoria: string }>(`/admin/usuarios/${u.id}/redefinir-senha`, {});
      setSenha({ nome: u.nome, email: u.email, senha: r.senha_provisoria });
      atualizar();
    } catch (e) {
      erro(e);
    }
  };

  const alternarAtivo = async (u: U) => {
    if (u.ativo) {
      const ok = await confirmar({
        titulo: `Desativar ${u.nome}?`,
        texto:
          "A pessoa perde o acesso na hora. O histórico e os comentários dela são mantidos, e você pode reativar depois.",
        acao: "Desativar",
        perigo: true,
      });
      if (!ok) return;
    }
    try {
      await cliente.patch(`/admin/usuarios/${u.id}`, { ativo: !u.ativo });
      avisar(u.ativo ? "Usuário desativado." : "Usuário reativado.");
      atualizar();
    } catch (e) {
      erro(e);
    }
  };

  return (
    <main className="pagina">
      <div className="cabecalho-pagina">
        <h1 className="titulo-pagina">Usuários e perfis</h1>
        <div className="linha-inline">
          {p.acoesCabecalho}
          {aba === "usuarios" && (
            <button className="botao botao-primario" onClick={() => setEditando("novo")}>
              <Plus size={16} /> Novo usuário
            </button>
          )}
        </div>
      </div>

      <div className="abas abas-pagina" role="tablist">
        <button role="tab" aria-selected={aba === "usuarios"} onClick={() => setAba("usuarios")}>
          Usuários <span className="contagem">{data.length}</span>
        </button>
        <button role="tab" aria-selected={aba === "perfis"} onClick={() => setAba("perfis")}>
          Perfis de acesso
        </button>
      </div>

      {aba === "perfis" ? (
        <AbaPerfis
          perfis={perfis}
          permissaoInterna={p.permissaoInterna}
          textoPerfilVazio={p.textoPerfilVazio}
          avisoSemInterna={p.avisoSemInterna}
          aoMudar={atualizar}
        />
      ) : (
        <>
          <div className="barra-lista">
            <p className="texto-apoio sem-margem">
              O que cada pessoa vê e pode fazer depende do <strong>perfil de acesso</strong> dela (aba ao lado). Ao
              criar um usuário, o sistema gera uma senha provisória para você repassar; a pessoa cria a própria senha no
              primeiro acesso.
            </p>
            <label className="busca">
              <Search size={15} />
              <input
                placeholder={p.placeholderBusca ?? "Buscar por nome ou e-mail"}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </label>
          </div>

          {usuarios.carregando && <p className="texto-apoio">Carregando…</p>}
          {lista.length > 0 && (
            <div className="tabela-projetos">
              <div className="linha-usuario cabecalho">
                <span>Nome</span>
                <span>Perfil</span>
                <span>Situação</span>
                <span>Último acesso</span>
                <span />
              </div>
              {lista.map((u) => (
                <div key={u.id} className={`linha-usuario ${u.ativo ? "" : "inativo"}`}>
                  <span className="nome-projeto">
                    <strong>
                      {u.nome}
                      {u.id === usuario!.id ? " (você)" : ""}
                    </strong>
                    <span className="tipo-projeto">{u.email}</span>
                  </span>
                  <span>
                    {u.perfil_nome ?? <em className="apagado">Sem perfil</em>}
                    {p.complementoPerfil?.(u)}
                    {u.administrador && <span className="selo selo-modelo">Admin</span>}
                    {p.detalheUsuario?.(u)}
                  </span>
                  <span>
                    {!u.ativo ? (
                      <span className="selo selo-cancelado">Desativado</span>
                    ) : u.precisa_trocar_senha ? (
                      <span className="selo selo-pausado" title="Ainda não criou a própria senha">
                        Aguardando 1º acesso
                      </span>
                    ) : (
                      <span className="selo selo-concluido">Ativo</span>
                    )}
                  </span>
                  <span className="numeros">{u.ultimo_acesso ? dataHora(u.ultimo_acesso) : "Nunca"}</span>
                  <span className="acoes-usuario">
                    <button className="botao botao-pequeno" onClick={() => setEditando(u)}>
                      Editar
                    </button>
                    <button className="botao botao-pequeno" onClick={() => redefinir(u)} title="Gerar senha provisória">
                      <KeyRound size={14} />
                    </button>
                    {u.id !== usuario!.id && (
                      <button className="botao botao-pequeno" onClick={() => alternarAtivo(u)}>
                        {u.ativo ? "Desativar" : "Reativar"}
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {editando && (
        <EditarUsuario<U>
          usuario={editando === "novo" ? null : editando}
          proprio={editando !== "novo" && editando.id === usuario!.id}
          perfis={perfis.dados}
          permissaoInterna={p.permissaoInterna}
          textoAdministrador={p.textoAdministrador}
          extensao={p.extensao}
          aoFechar={() => setEditando(null)}
          aoSalvar={(nova) => {
            setEditando(null);
            atualizar();
            if (nova) setSenha(nova);
          }}
        />
      )}
      {senha && <SenhaProvisoria {...senha} nomePlataforma={p.nomePlataforma} aoFechar={() => setSenha(null)} />}
    </main>
  );
}

function EditarUsuario<U extends UsuarioAdmin>({
  usuario,
  proprio,
  perfis,
  permissaoInterna,
  textoAdministrador,
  extensao,
  aoFechar,
  aoSalvar,
}: {
  usuario: U | null;
  proprio: boolean;
  perfis: PerfilAdmin[];
  permissaoInterna?: string;
  textoAdministrador?: string;
  extensao?: ExtensaoUsuario<U>;
  aoFechar: () => void;
  aoSalvar: (senhaNova?: { nome: string; email: string; senha: string }) => void;
}) {
  const { cliente } = useSessao();
  const { erro, avisar } = useAvisos();
  const [f, setF] = useState({
    nome: usuario?.nome ?? "",
    email: usuario?.email ?? "",
    perfil_id: usuario?.perfil_id ?? "",
    administrador: usuario?.administrador ?? false,
  });
  const [extra, setExtra] = useState(() => extensao?.inicial(usuario));
  const [salvando, setSalvando] = useState(false);
  const perfil = perfis.find((x) => x.id === f.perfil_id);
  // sem a permissão interna = usuário externo (não pode ser administrador)
  const externo = !!perfil && !!permissaoInterna && !perfil.permissoes.includes(permissaoInterna);

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.perfil_id) return erro(new Error("Escolha o perfil de acesso."));
    setSalvando(true);
    try {
      const base = { nome: f.nome, email: f.email, perfil_id: f.perfil_id };
      const dados = {
        ...base,
        ...(extensao?.dados?.(extra, externo) ?? {}),
        administrador: !externo && f.administrador,
      };
      let id = usuario?.id;
      let nova: { nome: string; email: string; senha: string } | undefined;
      if (usuario) {
        await cliente.patch(`/admin/usuarios/${usuario.id}`, proprio ? base : dados);
      } else {
        const r = await cliente.post<{ id: string; senha_provisoria: string }>("/admin/usuarios", dados);
        id = r.id;
        nova = { nome: f.nome, email: f.email, senha: r.senha_provisoria };
      }
      if (id && extensao?.depoisDeSalvar) await extensao.depoisDeSalvar(id, extra, usuario);
      if (!nova) avisar("Usuário salvo.");
      aoSalvar(nova);
    } catch (x) {
      erro(x);
      setSalvando(false);
    }
  };

  const Campos = extensao?.Campos;
  return (
    <Modal titulo={usuario ? `Editar ${usuario.nome}` : "Novo usuário"} aoFechar={aoFechar} largura={600}>
      <form className="formulario" onSubmit={salvar}>
        <div className="grade-2">
          <Campo rotulo="Nome">
            <input required autoFocus value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
          </Campo>
          <Campo rotulo="E-mail (usado no login)">
            <input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Campo>
        </div>

        <fieldset className="origem">
          <legend className="rotulo-campo">Perfil de acesso</legend>
          {perfis.map((x) => (
            <label key={x.id} className={f.perfil_id === x.id ? "ativo" : ""}>
              <input
                type="radio"
                name="perfil"
                checked={f.perfil_id === x.id}
                onChange={() => setF({ ...f, perfil_id: x.id })}
              />
              <span>
                <strong>{x.nome}</strong>
                {x.descricao && <small>{x.descricao}</small>}
              </span>
            </label>
          ))}
          {!perfis.length && <p className="texto-apoio">Nenhum perfil cadastrado. Crie um na aba Perfis de acesso.</p>}
        </fieldset>

        {!externo && perfil && (
          <label className="opcao">
            <input
              type="checkbox"
              checked={f.administrador}
              disabled={proprio}
              onChange={(e) => setF({ ...f, administrador: e.target.checked })}
            />
            {textoAdministrador ?? "Administrador (tem todas as permissões e cadastra usuários e perfis)"}
          </label>
        )}
        {proprio && <p className="dica-campo">Você não pode remover o seu próprio acesso de administrador.</p>}

        {Campos && <Campos usuario={usuario} externo={externo} perfil={perfil} valor={extra} mudar={setExtra} />}

        <div className="acoes-modal">
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button className="botao botao-primario" disabled={salvando}>
            {salvando ? "Salvando…" : usuario ? "Salvar" : "Criar e gerar senha"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AbaPerfis({
  perfis,
  permissaoInterna,
  textoPerfilVazio,
  avisoSemInterna,
  aoMudar,
}: {
  perfis: { dados: PerfilAdmin[]; recarregar: () => Promise<void> };
  permissaoInterna?: string;
  textoPerfilVazio?: string;
  avisoSemInterna?: ReactNode;
  aoMudar: () => void;
}) {
  const { cliente } = useSessao();
  const { erro, confirmar, avisar } = useAvisos();
  const catalogo = useLista<ItemCatalogo>("/admin/permissoes");
  const [editando, setEditando] = useState<PerfilAdmin | "novo" | null>(null);
  const nomes = useMemo(() => new Map(catalogo.dados.map((x) => [x.chave, x.nome])), [catalogo.dados]);

  const excluir = async (x: PerfilAdmin) => {
    const ok = await confirmar({
      titulo: `Excluir o perfil “${x.nome}”?`,
      texto: "Esta ação não pode ser desfeita.",
      acao: "Excluir perfil",
      perigo: true,
    });
    if (!ok) return;
    try {
      await cliente.delete(`/admin/perfis/${x.id}`);
      avisar("Perfil excluído.");
      await perfis.recarregar();
    } catch (e) {
      erro(e);
    }
  };

  return (
    <>
      <div className="barra-lista">
        <p className="texto-apoio sem-margem">
          Cada perfil reúne o que as pessoas dele podem ver e fazer. Ao alterar um perfil, a mudança vale na hora para
          todos que o usam. Administradores têm todas as permissões, qualquer que seja o perfil.
        </p>
        <button className="botao botao-primario" onClick={() => setEditando("novo")}>
          <Plus size={16} /> Novo perfil
        </button>
      </div>
      <div className="grade-perfis">
        {perfis.dados.map((x) => (
          <article key={x.id} className="cartao-perfil">
            <header>
              <h3>
                <ShieldCheck size={16} /> {x.nome}
              </h3>
              <span className="contagem">
                {x.qtd_usuarios} usuário{x.qtd_usuarios === 1 ? "" : "s"}
              </span>
            </header>
            {x.descricao && <p className="texto-apoio">{x.descricao}</p>}
            <ul>
              {x.permissoes.length ? (
                x.permissoes.map((k) => <li key={k}>{nomes.get(k) ?? k}</li>)
              ) : (
                <li className="apagado">{textoPerfilVazio ?? "Nenhuma permissão"}</li>
              )}
            </ul>
            <footer>
              <button className="botao botao-pequeno" onClick={() => setEditando(x)}>
                Editar
              </button>
              <button
                className="botao botao-pequeno"
                onClick={() => excluir(x)}
                disabled={x.qtd_usuarios > 0}
                title={x.qtd_usuarios > 0 ? "Em uso: mude o perfil das pessoas antes" : undefined}
              >
                Excluir
              </button>
            </footer>
          </article>
        ))}
      </div>
      {editando && (
        <EditarPerfil
          perfil={editando === "novo" ? null : editando}
          catalogo={catalogo.dados}
          permissaoInterna={permissaoInterna}
          avisoSemInterna={avisoSemInterna}
          aoFechar={() => setEditando(null)}
          aoSalvar={() => {
            setEditando(null);
            perfis.recarregar().catch(() => {});
            aoMudar();
          }}
        />
      )}
    </>
  );
}

function EditarPerfil({
  perfil,
  catalogo,
  permissaoInterna,
  avisoSemInterna,
  aoFechar,
  aoSalvar,
}: {
  perfil: PerfilAdmin | null;
  catalogo: ItemCatalogo[];
  permissaoInterna?: string;
  avisoSemInterna?: ReactNode;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const { cliente } = useSessao();
  const { erro, avisar } = useAvisos();
  const [nome, setNome] = useState(perfil?.nome ?? "");
  const [descricao, setDescricao] = useState(perfil?.descricao ?? "");
  const [marcadas, setMarcadas] = useState<Set<string>>(
    new Set(perfil?.permissoes ?? (permissaoInterna ? [permissaoInterna] : [])),
  );
  const [salvando, setSalvando] = useState(false);
  const grupos = useMemo(() => {
    const m = new Map<string, ItemCatalogo[]>();
    for (const x of catalogo) m.set(x.grupo, [...(m.get(x.grupo) ?? []), x]);
    return [...m.entries()];
  }, [catalogo]);
  const alternar = (k: string) =>
    setMarcadas((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    try {
      const dados = { nome, descricao: descricao || null, permissoes: [...marcadas] };
      if (perfil) await cliente.put(`/admin/perfis/${perfil.id}`, dados);
      else await cliente.post("/admin/perfis", dados);
      avisar(perfil ? "Perfil atualizado. A mudança já vale para quem o usa." : "Perfil criado.");
      aoSalvar();
    } catch (x) {
      erro(x);
      setSalvando(false);
    }
  };

  return (
    <Modal titulo={perfil ? `Perfil ${perfil.nome}` : "Novo perfil de acesso"} aoFechar={aoFechar} largura={640}>
      <form className="formulario" onSubmit={salvar}>
        <div className="grade-2">
          <Campo rotulo="Nome do perfil">
            <input
              required
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Diretoria"
            />
          </Campo>
          <Campo rotulo="Descrição">
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Para quem é este perfil"
            />
          </Campo>
        </div>
        {grupos.map(([grupo, itens]) => (
          <fieldset key={grupo} className="grupo-permissoes">
            <legend>{grupo}</legend>
            {itens.map((x) => (
              <label key={x.chave} className={`opcao-permissao ${marcadas.has(x.chave) ? "ativo" : ""}`}>
                <input type="checkbox" checked={marcadas.has(x.chave)} onChange={() => alternar(x.chave)} />
                <span>
                  <strong>{x.nome}</strong>
                  <small>{x.descricao}</small>
                </span>
              </label>
            ))}
          </fieldset>
        ))}
        {permissaoInterna && !marcadas.has(permissaoInterna) && avisoSemInterna && (
          <p className="aviso-temporario">{avisoSemInterna}</p>
        )}
        <div className="acoes-modal">
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button className="botao botao-primario" disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar perfil"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Mostra a senha provisória uma única vez, com um texto pronto para enviar. */
export function SenhaProvisoria({
  nome,
  email,
  senha,
  nomePlataforma = "plataforma",
  aoFechar,
}: {
  nome: string;
  email: string;
  senha: string;
  nomePlataforma?: string;
  aoFechar: () => void;
}) {
  const { avisar } = useAvisos();
  const endereco = enderecoTela();
  const mensagem = `Olá, ${nome.split(" ")[0]}! Seu acesso à ${nomePlataforma}:\n\nEndereço: ${endereco}\nE-mail: ${email}\nSenha provisória: ${senha}\n\nNo primeiro acesso você vai criar a sua própria senha.`;
  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      avisar("Copiado.");
    } catch {
      avisar("Não foi possível copiar automaticamente. Selecione o texto e copie.", "erro");
    }
  };
  return (
    <Modal titulo="Senha provisória gerada" aoFechar={aoFechar} largura={520}>
      <p className="texto-modal">
        Repasse para <strong>{nome}</strong> por um canal seguro (Teams, por exemplo).{" "}
        <strong>Esta senha não será mostrada de novo.</strong>
      </p>
      <div className="senha-provisoria">
        <code>{senha}</code>
        <button className="botao botao-pequeno" onClick={() => copiar(senha)}>
          <Copy size={14} /> Copiar senha
        </button>
      </div>
      <textarea className="mensagem-acesso" readOnly rows={7} value={mensagem} onFocus={(e) => e.target.select()} />
      <div className="acoes-modal">
        <button className="botao" onClick={() => copiar(mensagem)}>
          <Copy size={14} /> Copiar mensagem completa
        </button>
        <button className="botao botao-primario" onClick={aoFechar}>
          Pronto
        </button>
      </div>
    </Modal>
  );
}
