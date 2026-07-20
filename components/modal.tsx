"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// Pilha global (fora do React) de modais montados no momento, na ordem em
// que abriram — usada só pra saber qual é o mais no topo quando o Esc é
// apertado. Alguns fluxos abrem um Modal de dentro de outro (ex.: criar
// contato rápido enquanto "Novo negócio" está aberto); sem isso, um único
// Esc fechava os dois de uma vez.
let modalStack: symbol[] = [];

const ModalDepthContext = createContext(0);

export function Modal({
  onClose,
  children,
  maxWidth = "max-w-sm",
}: {
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<symbol | undefined>(undefined);
  if (!idRef.current) idRef.current = Symbol("modal");
  const depth = useContext(ModalDepthContext);
  // Aninhado = tem outro Modal como ancestral na árvore (ver Provider
  // abaixo) — não é sobre modais "diferentes" na tela, é sobre um estar
  // literalmente dentro do outro.
  const isNested = depth > 0;

  useEffect(() => {
    const id = idRef.current!;
    modalStack.push(id);
    return () => {
      modalStack = modalStack.filter((s) => s !== id);
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (modalStack[modalStack.length - 1] === idRef.current) onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return (
    <ModalDepthContext.Provider value={depth + 1}>
      {createPortal(
        <div
          // Só o Modal mais externo escurece/borra o fundo — dois Modal
          // empilhados aplicando blur cada um por cima do outro somava opacidade
          // e virava um efeito "fantasma" duplicado atrás do painel de cima.
          className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${
            isNested ? "" : "bg-neutral-900/40 backdrop-blur-lg dark:bg-neutral-950/60"
          }`}
          style={{ animation: "modal-backdrop-in 150ms ease-out" }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div
            ref={panelRef}
            style={{ animation: "modal-panel-in 150ms ease-out" }}
            className={`surface-glass-panel scrollbar-thin w-full ${maxWidth} max-h-[90vh] overflow-y-auto rounded-xl p-5 ${
              isNested ? "shadow-2xl ring-1 ring-black/5 dark:ring-white/10" : ""
            }`}
          >
            {children}
          </div>
        </div>,
        // Sempre filho direto de <body> — nunca de um ancestral qualquer da
        // árvore (ex.: o <header> com backdrop-blur do layout). backdrop-filter
        // cria um novo "containing block" pra descendentes com position:fixed;
        // sem o portal, um Modal aberto de dentro do header (ex.: busca geral,
        // Cmd+K) tinha o "fixed inset-0" calculado relativo ao header de 56px
        // de altura em vez da tela inteira — o painel aparecia encolhido e
        // fora do lugar, grudado no topo em vez de centralizado.
        document.body,
      )}
    </ModalDepthContext.Provider>
  );
}
