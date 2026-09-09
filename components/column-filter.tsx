"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Filter, Check, Search } from "lucide-react";
import { useFloatingDropdown } from "@/lib/use-floating-dropdown";

type Option = { value: string; label: string };

// Mesmo limiar/motivo de components/select.tsx (SEARCH_THRESHOLD) — pedido
// explícito: campo de busca em TODO filtro suspenso do sistema que tiver
// várias opções, não só o Select genérico. Abaixo disso (poucas opções,
// dá pra ver a lista inteira de uma vez) o campo só ocuparia espaço à toa.
const SEARCH_THRESHOLD = 6;

/** Minúsculo + sem acento, só pra COMPARAR — nunca usado pra exibir nada.
 * Duplicada de components/select.tsx de propósito (mesmo comentário de lá):
 * função de 6 linhas, não vale criar uma dependência cruzada entre dois
 * componentes de UI genéricos só por causa dela. */
function foldForSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

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
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const active = !!value;
  const isSearchable = options.length > SEARCH_THRESHOLD;

  // "Todos os X" nunca é filtrado pela busca — é uma ação (limpar o
  // filtro), não um valor pesquisável; sempre fica fixo no topo, buscando
  // ou não.
  const visibleOptions = useMemo(() => {
    if (!isSearchable) return options;
    const term = foldForSearch(search.trim());
    if (!term) return options;
    return options.filter((o) => foldForSearch(o.label).includes(term));
  }, [options, search, isSearchable]);

  const coords = useFloatingDropdown({
    open,
    onClose: () => setOpen(false),
    triggerRef,
    panelRef,
    align,
  });

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearch("");
    // Foca a busca só depois do painel/input existirem de verdade no DOM —
    // mesmo raciocínio/raf de components/select.tsx.
    if (isSearchable) {
      const raf = requestAnimationFrame(() => searchInputRef.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
              // Mesmo raciocínio de components/select.tsx — o teto de altura
              // é do painel inteiro (busca + lista), não só da lista.
              maxHeight: Math.min(320 + (isSearchable ? 40 : 0), coords.maxHeight),
            }}
            className="surface-glass-filter animate-pop-in fixed z-40 flex w-56 flex-col overflow-hidden rounded-lg py-1 text-left text-xs font-normal normal-case shadow-xl"
          >
            {isSearchable && (
              <div className="relative shrink-0 border-b border-neutral-200/70 px-2 pb-1.5 dark:border-neutral-700/70">
                <Search
                  className="pointer-events-none absolute top-1/2 left-4 h-3 w-3 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
                  strokeWidth={2}
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar..."
                  className="w-full rounded bg-transparent py-1 pr-2 pl-6 text-xs text-neutral-800 outline-none placeholder:text-neutral-400 dark:text-neutral-200 dark:placeholder:text-neutral-500"
                />
              </div>
            )}
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1 pt-1">
              <FilterOption label={allLabel} selected={!value} onClick={() => { onChange(""); setOpen(false); }} />
              {isSearchable && visibleOptions.length === 0 ? (
                <p className="px-2 py-1.5 text-neutral-400 dark:text-neutral-500">Nenhum resultado</p>
              ) : (
                visibleOptions.map((o) => (
                  <FilterOption
                    key={o.value}
                    label={o.label}
                    selected={value === o.value}
                    onClick={() => { onChange(o.value); setOpen(false); }}
                  />
                ))
              )}
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
