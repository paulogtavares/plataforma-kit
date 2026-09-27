/** Modal, campo de formulário, avisos rápidos (toasts) e confirmação: base das telas do kit e dos módulos. */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

export function Modal({
  titulo,
  aoFechar,
  children,
  largura = 520,
}: {
  titulo: string;
  aoFechar: () => void;
  children: ReactNode;
  largura?: number;
}) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [aoFechar]);
  return (
    <div className="fundo-modal" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo} style={{ width: largura }}>
        <header className="cabecalho-modal">
          <h2>{titulo}</h2>
          <button className="botao-icone" onClick={aoFechar} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>
        <div className="corpo-modal">{children}</div>
      </div>
    </div>
  );
}

export function Campo({ rotulo, children, dica }: { rotulo: string; children: ReactNode; dica?: string }) {
  return (
    <label className="campo">
      <span className="rotulo-campo">{rotulo}</span>
      {children}
      {dica && <span className="dica-campo">{dica}</span>}
    </label>
  );
}

interface Aviso {
  id: number;
  texto: string;
  tipo: "ok" | "erro";
}
export interface PedidoConfirmacao {
  titulo: string;
  texto?: string;
  acao: string;
  perigo?: boolean;
}
export interface Avisos {
  avisar: (texto: string, tipo?: "ok" | "erro") => void;
  /** mostra a mensagem de um erro (ErroRequisicao, Error ou texto) */
  erro: (e: unknown) => void;
  /** janela de confirmação; resolve true se a pessoa confirmar */
  confirmar: (o: PedidoConfirmacao) => Promise<boolean>;
}
const AvisosCtx = createContext<Avisos | null>(null);

export function ProvedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [pedido, setPedido] = useState<(PedidoConfirmacao & { resolver: (ok: boolean) => void }) | null>(null);
  const seq = useRef(0);

  const avisar = useCallback((texto: string, tipo: "ok" | "erro" = "ok") => {
    const id = ++seq.current;
    setAvisos((a) => [...a, { id, texto, tipo }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), tipo === "erro" ? 6000 : 3000);
  }, []);
  const erro = useCallback((e: unknown) => avisar(e instanceof Error ? e.message : String(e), "erro"), [avisar]);
  const confirmar = useCallback(
    (o: PedidoConfirmacao) => new Promise<boolean>((resolver) => setPedido({ ...o, resolver })),
    [],
  );
  const fechar = (ok: boolean) => {
    pedido?.resolver(ok);
    setPedido(null);
  };

  return (
    <AvisosCtx.Provider value={{ avisar, erro, confirmar }}>
      {children}
      <div className="avisos" role="status" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={`aviso aviso-${a.tipo}`}>
            {a.texto}
          </div>
        ))}
      </div>
      {pedido && (
        <Modal titulo={pedido.titulo} aoFechar={() => fechar(false)} largura={420}>
          {pedido.texto && <p className="texto-modal">{pedido.texto}</p>}
          <div className="acoes-modal">
            <button className="botao" onClick={() => fechar(false)}>
              Voltar
            </button>
            <button
              className={`botao ${pedido.perigo ? "botao-perigo" : "botao-primario"}`}
              autoFocus
              onClick={() => fechar(true)}
            >
              {pedido.acao}
            </button>
          </div>
        </Modal>
      )}
    </AvisosCtx.Provider>
  );
}

export function useAvisos(): Avisos {
  const c = useContext(AvisosCtx);
  if (!c) throw new Error("useAvisos precisa estar dentro de <ProvedorAvisos>.");
  return c;
}
