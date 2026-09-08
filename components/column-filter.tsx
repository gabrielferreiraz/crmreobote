"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Filter, Check } from "lucide-react";
import { useFloatingDropdown } from "@/lib/use-floating-dropdown";

type Option = { value: string; label: string };

/**
 * Filtro rápido embutido no cabeçalho da coluna (estilo planilha) — ícone de
 * funil que abre um popover com as opções, sem precisar abrir o painel de
 * Filtros geral. Mesma fonte de estado que esse painel (ver
 * contacts-table.tsx) — os dois nunca desandam um do outro, escolher aqui
 * reflete lá e vice-versa.
 *
 * Sempre busca no SERVIDOR (o `onChange` troca o estado que dispara o
 * useEffect de busca) — nunca filtra só a página atual já carregada, senão
 * "filtrar por Origem" só acharia entre os 50 contatos já na tela.
 */
export function ColumnFilter({
  value,
  onChange,
  options,
  allLabel = "Todos",
  align = "left",
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  allLabel?: string;
  /** "right" pra coluna perto da borda direita da tabela (ex.: Valor) —
   * senão o painel (que sempre abre pra baixo alinhado pela esquerda por
   * padrão) pode estourar pra fora da tela num viewport estreito. */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const active = !!value;

  const coords = useFloatingDropdown({
    open,
    onClose: () => setOpen(false),
    triggerRef,
    panelRef,
    align,
  });

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="Filtrar coluna"
        className={`shrink-0 rounded p-0.5 transition-colors ${
          active
            ? "text-brand"
            : "text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-200"
        }`}
      >
        <Filter className="h-3 w-3" strokeWidth={2.25} fill={active ? "currentColor" : "none"} />
      </button>

      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              top: coords.top,
              bottom: coords.bottom,
              right: coords.right,
              left: coords.left,
              maxHeight: Math.min(320, coords.maxHeight),
            }}
            className="surface-glass-filter animate-pop-in fixed z-40 flex w-56 flex-col overflow-hidden rounded-lg py-1 text-left text-xs font-normal normal-case shadow-xl"
          >
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1">
              <FilterOption label={allLabel} selected={!value} onClick={() => { onChange(""); setOpen(false); }} />
              {options.map((o) => (
                <FilterOption
                  key={o.value}
                  label={o.label}
                  selected={value === o.value}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                />
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function FilterOption({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
        selected ? "font-medium text-neutral-900 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-400"
      }`}
    >
      <Check className={`h-3 w-3 shrink-0 ${selected ? "opacity-100" : "opacity-0"}`} strokeWidth={2.5} />
      <span className="truncate">{label}</span>
    </button>
  );
}
