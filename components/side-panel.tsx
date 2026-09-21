"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Painel deslizando da direita — mesmo espírito do Modal, mas ancorado na borda pra fluxos de cadastro rápido sem tirar o usuário do contexto atual. */
export function SidePanel({
  onClose,
  title,
  children,
  maxWidth = "max-w-md",
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Classe de largura máxima do painel — padrão max-w-md (cadastro rápido); listas com mais colunas de informação pedem mais. */
  maxWidth?: string;
}) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Portal pro body — como o Modal: um SidePanel aberto de dentro de um card
  // com blur/transform (ex.: ranking do relatório) teria o `fixed` ancorado
  // no card em vez da tela, ficando espremido e cortado.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end bg-neutral-900/40 backdrop-blur-lg dark:bg-neutral-950/60"
      style={{ animation: "modal-backdrop-in 180ms var(--ease-smooth)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`surface-glass-panel animate-sheet-right scrollbar-thin flex h-full w-full ${maxWidth} flex-col overflow-y-auto border-y-0 border-r-0 p-5 pb-8`}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Fechar">
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
