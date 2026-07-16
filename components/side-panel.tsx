"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

/** Painel deslizando da direita — mesmo espírito do Modal, mas ancorado na borda pra fluxos de cadastro rápido sem tirar o usuário do contexto atual. */
export function SidePanel({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-neutral-900/40 backdrop-blur-lg dark:bg-neutral-950/60"
      style={{ animation: "modal-backdrop-in 150ms ease-out" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="surface-glass-panel animate-sheet-right scrollbar-thin flex h-full w-full max-w-md flex-col overflow-y-auto border-y-0 border-r-0 p-5"
      >
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Fechar">
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
