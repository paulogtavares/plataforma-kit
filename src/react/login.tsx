/** Tela de login, troca obrigatória da senha provisória e janela de trocar senha. */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Campo, Modal, useAvisos } from "./avisos.js";
import { useSessao } from "./sessao.js";

/** O que a tela de login usa do /api/status. */
export interface StatusLogin {
  version: string;
  buildDate: string;
  sem_administrador?: boolean;
  acesso_teste?: { senha: string; emails: { email: string; perfil: string }[] };
}

const dataBr = (iso: string) => iso.split("-").reverse().join("/");

export function TelaLogin({
  subtitulo,
  marca,
  status: statusRecebido,
  buscarStatus,
}: {
  /** frase abaixo de "Entrar" (ex.: "Plataforma de cronogramas de implantação") */
  subtitulo: string;
  /** símbolo do módulo acima do título */
  marca?: ReactNode;
  /** status já carregado pelo módulo (nome, versão, modo de teste); sem ele, a tela busca com buscarStatus */
  status?: StatusLogin | null;
  buscarStatus?: () => Promise<StatusLogin>;
}) {
  const { entrar } = useSessao();
  const [statusProprio, setStatusProprio] = useState<StatusLogin | null>(null);
  const status = statusRecebido ?? statusProprio;
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (statusRecebido !== undefined || !buscarStatus) return;
    buscarStatus().then(setStatusProprio, () => {});
  }, [statusRecebido, buscarStatus]);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await entrar(email, senha);
    } catch (x) {
      // "E-mail ou senha incorretos." e "Muitas tentativas erradas…" vêm prontas da API
      setErro(x instanceof Error ? x.message : String(x));
      setEnviando(false);
    }
  };

  return (
    <main className="pagina-login">
      <form className="cartao-login" onSubmit={enviar}>
        {marca}
        <h1>Entrar</h1>
        <p className="texto-apoio">{subtitulo}</p>

        <label className="campo">
          <span className="rotulo-campo">E-mail</span>
          <input
            type="email"
            autoComplete="username"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="campo">
          <span className="rotulo-campo">Senha</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
        </label>
        {erro && (
          <p className="erro-login" role="alert">
            {erro}
          </p>
        )}
        <button className="botao botao-primario botao-largo" disabled={enviando}>
          {enviando ? "Entrando…" : "Entrar"}
        </button>
        <p className="dica-campo centro">Esqueceu a senha? Peça a um administrador para gerar uma nova.</p>

        {status?.sem_administrador && !status.acesso_teste && (
          <p className="aviso-temporario">
            Nenhum administrador cadastrado. Defina <code>ADMIN_EMAIL</code> e <code>ADMIN_SENHA</code> nas variáveis do
            servidor (ou no arquivo <code>.env</code>, ao lado do <code>server.js</code>) e reinicie.
          </p>
        )}

        {status?.acesso_teste && (
          <div className="caixa-teste">
            <strong>Ambiente de testes</strong>
            <span>
              Clique num usuário para preencher. Senha de todos: <code>{status.acesso_teste.senha}</code>
            </span>
            <ul>
              {status.acesso_teste.emails.map((u) => (
                <li key={u.email}>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail(u.email);
                      setSenha(status.acesso_teste!.senha);
                    }}
                  >
                    <span>{u.email}</span>
                    <small>{u.perfil}</small>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {status && (
          <p className="versao-login">
            v{status.version} · {dataBr(status.buildDate)}
          </p>
        )}
      </form>
    </main>
  );
}

function FormularioSenha({
  obrigatoria,
  aoConcluir,
  aoCancelar,
}: {
  obrigatoria: boolean;
  aoConcluir: () => void;
  aoCancelar?: () => void;
}) {
  const { trocarSenha } = useSessao();
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (nova !== confirma) return setErro("A confirmação não confere com a nova senha.");
    setEnviando(true);
    try {
      await trocarSenha(atual, nova);
      aoConcluir();
    } catch (x) {
      setErro(x instanceof Error ? x.message : String(x));
      setEnviando(false);
    }
  };

  return (
    <form className="formulario" onSubmit={enviar}>
      <Campo rotulo={obrigatoria ? "Senha provisória (a que você recebeu)" : "Senha atual"}>
        <input
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={atual}
          onChange={(e) => setAtual(e.target.value)}
        />
      </Campo>
      <Campo rotulo="Nova senha" dica="Pelo menos 8 caracteres, com letras e números.">
        <input
          type="password"
          autoComplete="new-password"
          required
          value={nova}
          onChange={(e) => setNova(e.target.value)}
        />
      </Campo>
      <Campo rotulo="Confirme a nova senha">
        <input
          type="password"
          autoComplete="new-password"
          required
          value={confirma}
          onChange={(e) => setConfirma(e.target.value)}
        />
      </Campo>
      {erro && (
        <p className="erro-login" role="alert">
          {erro}
        </p>
      )}
      <div className="acoes-modal">
        {aoCancelar && (
          <button type="button" className="botao" onClick={aoCancelar}>
            Cancelar
          </button>
        )}
        <button className="botao botao-primario" disabled={enviando}>
          {enviando ? "Salvando…" : "Salvar nova senha"}
        </button>
      </div>
    </form>
  );
}

/** Tela obrigatória no primeiro acesso (ou depois de uma senha redefinida). */
export function TelaTrocaSenha() {
  const { usuario, recarregar, sair } = useSessao();
  return (
    <main className="pagina-login">
      <div className="cartao-login">
        <h1>Crie sua senha</h1>
        <p className="texto-apoio">
          Olá, {usuario?.nome.split(" ")[0]}! Você entrou com uma senha provisória. Para continuar, crie uma senha
          pessoal.
        </p>
        <FormularioSenha obrigatoria aoConcluir={recarregar} />
        <button className="botao-link" onClick={sair}>
          Sair
        </button>
      </div>
    </main>
  );
}

export function ModalTrocarSenha({ aoFechar }: { aoFechar: () => void }) {
  const { avisar } = useAvisos();
  return (
    <Modal titulo="Trocar senha" aoFechar={aoFechar} largura={440}>
      <FormularioSenha
        obrigatoria={false}
        aoCancelar={aoFechar}
        aoConcluir={() => {
          avisar("Senha alterada. Outras sessões abertas foram encerradas.");
          aoFechar();
        }}
      />
    </Modal>
  );
}
