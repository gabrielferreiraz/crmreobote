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
  children,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        {label}
      </button>

      {open && (
        <div className="surface-glass animate-pop-in absolute left-0 z-40 mt-2 w-56 space-y-2 rounded-lg p-3 shadow-xl">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
