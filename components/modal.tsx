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

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/**
 * Mantém o Tab circulando dentro do painel. Só age quando o foco está NO
 * painel (ou perdido no <body>): Select, DatePicker, TimePicker e a busca de
 * contato abrem o popover num portal FORA do painel — puxar o foco de volta
 * dali quebraria a navegação por teclado dentro deles.
 */
function trapTab(e: KeyboardEvent, panel: HTMLElement | null) {
  if (!panel) return;
  const active = document.activeElement;
  const inside = !!active && panel.contains(active);
  if (!inside && active && active !== document.body) return;

  const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
  if (items.length === 0) {
    e.preventDefault();
    panel.focus({ preventScroll: true });
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && (!inside || active === first || active === panel)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (!inside || active === last)) {
    e.preventDefault();
    first.focus();
  }
}

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
  const idRef = useRef<symbol | null>(null);
  if (idRef.current == null) idRef.current = Symbol("modal");
  const depth = useContext(ModalDepthContext);
  // Aninhado = tem outro Modal como ancestral na árvore (ver Provider
  // abaixo) — não é sobre modais "diferentes" na tela, é sobre um estar
  // literalmente dentro do outro.
  const isNested = depth > 0;

  useEffect(() => {
    const id = idRef.current!;
    modalStack.push(id);

    // Acessibilidade (auditoria 09/2026): quem abriu o modal pelo teclado
    // ficava com o foco "atrás" dele — Tab navegava pela página escondida e,
    // ao fechar, o foco se perdia no topo do documento.
    //  - guarda quem tinha o foco antes e devolve ao fechar;
    //  - leva o foco pro painel (não pro 1º botão — que costuma ser o "X" e
    //    ganharia um anel de foco estranho), a não ser que um campo com
    //    autoFocus lá dentro já tenha pego o foco;
    //  - dá nome ao diálogo a partir do 1º título, pro leitor de tela.
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (panel) {
      if (!panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
      if (!panel.hasAttribute("aria-labelledby")) {
        const heading = panel.querySelector<HTMLElement>("h1, h2, h3");
        if (heading) {
          if (!heading.id) heading.id = `modal-title-${Math.random().toString(36).slice(2, 10)}`;
          panel.setAttribute("aria-labelledby", heading.id);
        }
      }
    }

    return () => {
      modalStack = modalStack.filter((s) => s !== id);
      if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (modalStack[modalStack.length - 1] !== idRef.current) return;
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab") trapTab(e, panelRef.current);
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
          style={{ animation: "modal-backdrop-in 180ms var(--ease-smooth)" }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            // --ease-spring (não --ease-smooth) só no painel, não no fundo
            // acima: o painel é o que "chega" na tela, o fundo só esmaece —
            // dar um pouco de "estica além e volta" nele é o que lê como
            // apresentação nativa (iOS/macOS), não como um <div> aparecendo.
            style={{ animation: "modal-panel-in 280ms var(--ease-spring)" }}
            className={`surface-glass-panel scrollbar-thin w-full outline-none ${maxWidth} max-h-[90vh] overflow-y-auto rounded-xl p-5 pb-7 ${
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
