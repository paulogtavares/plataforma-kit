/** Casca do módulo: barra superior com nome, versão, espaço para abas e menu do usuário. Some dentro do portal. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { ChevronDown, KeyRound, LogOut } from "lucide-react";
import { dentroDeIframe } from "../web.js";
import { ModalTrocarSenha } from "./login.js";
import { useSessao } from "./sessao.js";

export interface ItemMenuUsuario {
  rotulo: string;
  icone?: ReactNode;
  /** caminho do módulo (ex.: "/usuarios") */
  caminho?: string;
  aoClicar?: () => void;
  somenteAdministrador?: boolean;
}

const dataBr = (iso: string) => iso.split("-").reverse().join("/");

export function Casca({
  nome,
  versao,
  data,
  marca,
  inicio = "/",
  abas,
  acoes,
  depois,
  mostrarMenu = true,
  itensMenu = [],
  embutido = dentroDeIframe(),
}: {
  nome: string;
  versao: string;
  /** data da versão, AAAA-MM-DD */
  data: string;
  /** símbolo antes do nome */
  marca?: ReactNode;
  inicio?: string;
  /** abas do módulo, entre a versão e o menu */
  abas?: ReactNode;
  /** botões antes do menu do usuário */
  acoes?: ReactNode;
  /** conteúdo depois do menu do usuário */
  depois?: ReactNode;
  mostrarMenu?: boolean;
  /** itens do menu antes de "Trocar senha" e "Sair" */
  itensMenu?: ItemMenuUsuario[];
  /** dentro do iframe do portal a casca não aparece (o menu do portal substitui) */
  embutido?: boolean;
}) {
  const { usuario } = useSessao();
  if (embutido) return null;
  return (
    <header className="topo">
      <Link to={inicio} className="marca">
        {marca}
        {nome}
      </Link>
      <span className="versao-app" title={`Versão ${versao}, gerada em ${dataBr(data)}`}>
        v{versao} · {dataBr(data)}
      </span>
      {abas}
      <div className="topo-direita" style={{ marginLeft: "auto" }}>
        {acoes}
        {mostrarMenu && usuario && <MenuUsuario itens={itensMenu} />}
        {depois}
      </div>
    </header>
  );
}

/** Menu com o nome de quem está logado: itens do módulo, trocar senha e sair. */
export function MenuUsuario({ itens = [] }: { itens?: ItemMenuUsuario[] }) {
  const { usuario, sair } = useSessao();
  const nav = useNavigate();
  const [aberto, setAberto] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setAberto(false);
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);
  if (!usuario) return null;
  const iniciais = usuario.nome
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  return (
    <div className="menu-usuario" ref={ref}>
      <button className="botao-topo" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} aria-haspopup="menu">
        <span className="avatar">{iniciais}</span>
        <span className="nome-usuario-topo">{usuario.nome}</span>
        <ChevronDown size={14} />
      </button>
      {aberto && (
        <div className="menu-linha menu-usuario-lista" role="menu">
          <div className="menu-cabecalho">
            <strong>{usuario.nome}</strong>
            <span>{usuario.email}</span>
            <span>
              {[
                usuario.perfil_nome ?? (usuario.tipo === "interno" ? "Equipe interna" : "Cliente"),
                usuario.administrador ? "administrador" : null,
              ]
                .filter(Boolean)
                .join(", ")}
            </span>
          </div>
          <hr />
          {itens
            .filter((i) => !i.somenteAdministrador || usuario.administrador)
            .map((i) => (
              <button
                key={i.rotulo}
                role="menuitem"
                onClick={() => {
                  setAberto(false);
                  if (i.aoClicar) i.aoClicar();
                  else if (i.caminho) nav(i.caminho);
                }}
              >
                {i.icone} {i.rotulo}
              </button>
            ))}
          <button
            role="menuitem"
            onClick={() => {
              setAberto(false);
              setTrocando(true);
            }}
          >
            <KeyRound size={14} /> Trocar senha
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setAberto(false);
              sair();
            }}
          >
            <LogOut size={14} /> Sair
          </button>
        </div>
      )}
      {trocando && <ModalTrocarSenha aoFechar={() => setTrocando(false)} />}
    </div>
  );
}
