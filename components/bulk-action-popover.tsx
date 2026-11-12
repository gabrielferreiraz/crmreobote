"use client";

import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";

/**
 * Botão de ícone+rótulo que abre um popover pequeno (mesmo padrão de
 * fechar-ao-clicar-fora do FilterPopover) — usado pelas ações da
 * `SelectionBar` que precisam de um valor antes de aplicar (trocar cargo,
 * origem, responsável, etiquetar). `children` recebe `close` pra a própria
 * ação fechar o popover depois de aplicar com sucesso.
 */
export function BulkActionPopover({
  icon: Icon,
  label,
  variant = "bar",
  children,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  /** "bar" = chip na SelectionBar (padrão). "menu" = linha de um menu
   * vertical (ver DealBulkActions layout="menu"): ocupa a largura toda e
   * abre o painel AO LADO, não embaixo — embaixo ele cobriria as outras
   * ações do próprio menu. */
  variant?: "bar" | "menu";
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      // Mesmo motivo do FilterPopover: o <Select> usado dentro do popover
      // (Cargo/Origem/Responsável/Funil/Etapa) renderiza sua lista via portal
      // no document.body — sem essa checagem, escolher uma opção fecha este
      // popover antes do onChange disparar.
      if (target.closest('[role="listbox"]')) return;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          variant === "menu"
            ? "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
            : "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
        }
      >
        <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        {label}
      </button>

      {open && (
        <div
          className={
            variant === "menu"
              ? "surface-glass animate-pop-in absolute top-0 left-full z-50 ml-1 w-56 space-y-2 rounded-lg p-3 shadow-xl"
              : "surface-glass animate-pop-in absolute left-0 z-40 mt-2 w-56 space-y-2 rounded-lg p-3 shadow-xl"
          }
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
