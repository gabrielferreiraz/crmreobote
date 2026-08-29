"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SlidersHorizontal, X } from "lucide-react";
import { useFloatingDropdown } from "@/lib/use-floating-dropdown";

/**
 * O painel usava `position: absolute` relativo ao próprio botão — parecia
 * funcionar, mas era cortado por QUALQUER ancestral com overflow não-visível
 * entre ele e a tela (o `<main>` das rotas "app shell" como Pipeline tem
 * `overflow-y-hidden` de propósito, ver app-main.tsx). Um `max-height` no
 * painel não resolve isso: o corte acontece na borda do ANCESTRAL, antes do
 * tamanho do próprio painel importar. Mesmo problema que `<Select>` já tinha
 * resolvido (ver comentário de useFloatingDropdown) — agora reaproveita a
 * mesma solução: `createPortal` pro body (escapa de qualquer ancestral) +
 * coordenadas calculadas a partir da posição real do botão na tela.
 */
export function FilterPopover({
  active,
  onClear,
  children,
}: {
  active: boolean;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const coords = useFloatingDropdown({
    open,
    onClose: () => setOpen(false),
    triggerRef,
    panelRef,
    align: "right",
  });

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        aria-label="Filtros"
        className={`icon-btn relative h-9 w-9 border ${
          active
            ? "border-neutral-900 text-neutral-900 dark:border-white dark:text-white"
            : "border-neutral-300 dark:border-neutral-700"
        }`}
      >
        <SlidersHorizontal className="h-4 w-4" strokeWidth={2} />
        {active && (
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-neutral-900 dark:bg-white" />
        )}
      </button>

      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            // 512px (32rem) como teto PREFERIDO, mas nunca mais que o
            // espaço seguro calculado pelo hook (coords.maxHeight já
            // considera onde o gatilho está de verdade na tela, inclusive
            // abrindo pra CIMA — coords.bottom — quando sobra pouco espaço
            // embaixo dele). Um max-h fixo tipo "100vh menos uma margem"
            // (o que era usado antes) ignora a posição do gatilho e ainda
            // estoura quando ele está perto do fim da página.
            style={{
              top: coords.top,
              bottom: coords.bottom,
              right: coords.right,
              left: coords.left,
              maxHeight: Math.min(512, coords.maxHeight),
            }}
            className="surface-glass-filter animate-pop-in fixed z-40 flex w-72 flex-col overflow-hidden rounded-lg shadow-xl"
          >
            <div className="flex shrink-0 items-center justify-between p-3 pb-0">
              <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Filtros</p>
              {active && onClear && (
                <button
                  onClick={onClear}
                  className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                >
                  <X className="h-3 w-3" strokeWidth={2} />
                  Limpar
                </button>
              )}
            </div>
            <div className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-3">{children}</div>
          </div>,
          document.body,
        )}
    </>
  );
}
