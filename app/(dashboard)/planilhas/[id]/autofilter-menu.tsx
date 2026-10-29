"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownAZ, ArrowUpAZ, ChevronRight, FilterX, Search, Settings2 } from "lucide-react";
import { LoadingDots } from "@/components/loading-dots";
import { displayCell, isNumericType, isReferenceType, type ClientColumn } from "@/lib/sheets/format";
import { SHEET_COLUMN_TYPE_LABELS, type CellValue, type SheetColumnType } from "@/lib/sheets/column-types";
import type { FilterOp, RowFilter } from "@/lib/sheets/rows";
import { ColumnTypeIcon } from "./column-type-icon";

const QUICK_TYPES: { type: SheetColumnType; short: string }[] = [
  { type: "TEXT", short: "Texto" },
  { type: "CURRENCY", short: "Moeda R$" },
  { type: "NUMBER", short: "Número" },
  { type: "DATE", short: "Data" },
  { type: "SELECT", short: "Lista" },
  { type: "PERCENT", short: "%" },
];

const EMPTY = "\u0000vazias";

type Group = { key: string; label: string; count: number };

/** Operações do "Filtros de Texto / Número / Data" (submenu do AutoFiltro do Excel). */
function customOps(col: ClientColumn): { op: FilterOp; label: string }[] {
  if (isNumericType(col.type)) {
    return [
      { op: "eq", label: "É igual a" },
      { op: "neq", label: "É diferente de" },
      { op: "gt", label: "É maior do que" },
      { op: "gte", label: "É maior ou igual a" },
      { op: "lt", label: "É menor do que" },
      { op: "lte", label: "É menor ou igual a" },
    ];
  }
  if (col.type === "DATE") {
    return [
      { op: "eq", label: "Igual a" },
      { op: "lt", label: "Antes de" },
      { op: "gt", label: "Depois de" },
      { op: "lte", label: "Até" },
      { op: "gte", label: "A partir de" },
    ];
  }
  return [
    { op: "contains", label: "Contém" },
    { op: "notContains", label: "Não contém" },
    { op: "eq", label: "É igual a" },
    { op: "neq", label: "É diferente de" },
  ];
}

function filterNoun(col: ClientColumn) {
  if (isNumericType(col.type)) return "Filtros de Número";
  if (col.type === "DATE") return "Filtros de Data";
  return "Filtros de Texto";
}

/** Texto vindo do GROUP BY (sempre string no banco) → valor do tipo, para exibir igual à célula. */
function groupValue(col: ClientColumn, key: string): CellValue {
  if (isNumericType(col.type)) return Number(key);
  if (col.type === "CHECKBOX") return key === "true";
  if (col.type === "MULTI_SELECT") return [key];
  return key;
}

/**
 * O menu do botão ▾ do cabeçalho — o AutoFiltro do Excel: classificar,
 * limpar filtro, filtro personalizado e a lista de valores com caixas de
 * marcação ("(Selecionar Tudo)", "(Vazias)"), já respeitando os filtros das
 * outras colunas.
 */
export function AutoFilterMenu({
  sheetId,
  column,
  label,
  at,
  filters,
  match,
  sortDir,
  onSort,
  onApply,
  onQuickType,
  onEditColumn,
  onClose,
}: {
  sheetId: string;
  column: ClientColumn;
  /** Nome para mostrar (coluna sem título = "Coluna C"). */
  label: string;
  at: { x: number; y: number };
  filters: RowFilter[];
  match: "all" | "any";
  sortDir: "asc" | "desc" | null;
  onSort: (dir: "asc" | "desc") => void;
  /** Novos filtros DESTA coluna (substituem os anteriores dela); [] = sem filtro. */
  onApply: (columnFilters: RowFilter[]) => void;
  onQuickType?: (type: SheetColumnType) => void;
  onEditColumn?: () => void;
  onClose: () => void;
}) {
  const mine = filters.filter((f) => f.columnId === column.id);
  const others = filters.filter((f) => f.columnId !== column.id);
  const listFilter = mine.find((f) => f.op === "in");
  const customFilter = mine.find((f) => f.op !== "in");

  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string> | null>(() =>
    listFilter && Array.isArray(listFilter.value) ? new Set((listFilter.value as unknown[]).map((v) => (v === null ? EMPTY : String(v)))) : null,
  );
  const [customOpen, setCustomOpen] = useState(!!customFilter);
  const ops = customOps(column);
  const [customOp, setCustomOp] = useState<FilterOp>(customFilter?.op ?? ops[0].op);
  const [customValue, setCustomValue] = useState(customFilter ? String(customFilter.value ?? "") : "");

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/sheets/${sheetId}/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupBy: column.id, metrics: [{ fn: "count" }], ...(others.length && match === "all" ? { filters: others, match } : {}) }),
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Não foi possível carregar os valores");
        const refs: Record<string, string> = data.refs ?? {};
        const list: Group[] = (data.groups as { group: string | null; values: number[] }[]).map((g) =>
          g.group === null
            ? { key: EMPTY, label: "(Vazias)", count: g.values[0] }
            : { key: g.group, label: displayCell(column, groupValue(column, g.group), refs) || g.group, count: g.values[0] },
        );
        // Ordem do Excel: valores em ordem crescente, "(Vazias)" por último.
        list.sort((a, b) => {
          if (a.key === EMPTY) return 1;
          if (b.key === EMPTY) return -1;
          if (isNumericType(column.type)) return Number(a.key) - Number(b.key);
          if (column.type === "DATE") return a.key.localeCompare(b.key);
          return a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base", numeric: true });
        });
        setGroups(list);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- carrega uma vez ao abrir o menu
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (groups ?? []).filter((g) => !q || g.label.toLowerCase().includes(q));
  }, [groups, query]);

  const isChecked = (key: string) => (selected ? selected.has(key) : true);
  const allVisibleChecked = visible.length > 0 && visible.every((g) => isChecked(g.key));

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev ?? (groups ?? []).map((g) => g.key));
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev ?? (groups ?? []).map((g) => g.key));
      if (allVisibleChecked) visible.forEach((g) => next.delete(g.key));
      else visible.forEach((g) => next.add(g.key));
      return next;
    });
  }

  function apply() {
    if (customOpen && customValue.trim()) {
      onApply([{ columnId: column.id, op: customOp, value: customValue.trim() }]);
      return;
    }
    // Com busca digitada, o Excel aplica só o que está visível e marcado.
    const universe = query.trim() ? visible : (groups ?? []);
    const keys = universe.filter((g) => isChecked(g.key)).map((g) => g.key);
    const everything = !query.trim() && keys.length === (groups ?? []).length;
    if (everything || !groups) return onApply([]);
    onApply([{ columnId: column.id, op: "in", value: keys.map((k) => (k === EMPTY ? null : k)) }]);
  }

  const left = Math.max(8, Math.min(at.x, window.innerWidth - 300));
  const top = Math.min(at.y, window.innerHeight - 460);

  return (
    <div className="fixed inset-0 z-40" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div
        role="dialog"
        aria-label={`Filtro da coluna ${label}`}
        className="xl-menu-pop absolute w-72 overflow-hidden rounded-md border border-neutral-300 bg-white text-[13px] shadow-[0_8px_24px_rgba(0,0,0,0.18)] dark:border-neutral-700 dark:bg-neutral-900"
        style={{ left, top: Math.max(8, top) }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && !(e.target instanceof HTMLSelectElement)) apply();
        }}
      >
        {(onQuickType || onEditColumn) && (
          <div className="border-b border-neutral-200 bg-neutral-50/70 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-800/40">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 truncate text-xs font-semibold text-neutral-700 dark:text-neutral-200">
                <ColumnTypeIcon type={column.type} className="h-3.5 w-3.5 text-[var(--xl)]" />
                {label} · <span className="font-normal text-neutral-500">{SHEET_COLUMN_TYPE_LABELS[column.type]}</span>
              </span>
              {onEditColumn && (
                <button
                  type="button"
                  onClick={onEditColumn}
                  className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--xl)] hover:bg-[var(--xl-soft)]"
                >
                  <Settings2 className="h-3 w-3" /> Mais opções
                </button>
              )}
            </div>
            {onQuickType && (
              <div className="flex flex-wrap gap-1">
                {QUICK_TYPES.map((q) => {
                  const active = column.type === q.type;
                  return (
                    <button
                      key={q.type}
                      type="button"
                      onClick={() => !active && onQuickType(q.type)}
                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                        active
                          ? "border-[var(--xl)] bg-[var(--xl-soft)] text-[var(--xl)]"
                          : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                      }`}
                    >
                      <ColumnTypeIcon type={q.type} className="h-3 w-3" />
                      {q.short}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <div className="py-1">
          <MenuRow icon={ArrowDownAZ} active={sortDir === "asc"} onClick={() => onSort("asc")}>
            {isNumericType(column.type) ? "Classificar do Menor para o Maior" : column.type === "DATE" ? "Classificar do Mais Antigo para o Mais Novo" : "Classificar de A a Z"}
          </MenuRow>
          <MenuRow icon={ArrowUpAZ} active={sortDir === "desc"} onClick={() => onSort("desc")}>
            {isNumericType(column.type) ? "Classificar do Maior para o Menor" : column.type === "DATE" ? "Classificar do Mais Novo para o Mais Antigo" : "Classificar de Z a A"}
          </MenuRow>
          <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />
          <MenuRow icon={FilterX} disabled={!mine.length} onClick={() => onApply([])}>
            Limpar Filtro de &quot;{label}&quot;
          </MenuRow>
          {column.type !== "CHECKBOX" && !isReferenceType(column.type) && column.type !== "SELECT" && column.type !== "MULTI_SELECT" && (
            <button
              type="button"
              onClick={() => setCustomOpen((o) => !o)}
              className="flex w-full items-center justify-between px-3 py-1.5 pl-9 text-left text-neutral-800 hover:bg-[var(--xl-soft)] dark:text-neutral-200"
            >
              {filterNoun(column)}
              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${customOpen ? "rotate-90" : ""}`} />
            </button>
          )}
          {customOpen && (
            <div className="mx-3 mb-1 space-y-1.5 rounded border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-800/50">
              <select value={customOp} onChange={(e) => setCustomOp(e.target.value as FilterOp)} className="field-input w-full py-1 text-[13px]">
                {ops.map((o) => (
                  <option key={o.op} value={o.op}>{o.label}</option>
                ))}
              </select>
              <input
                autoFocus
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                placeholder={column.type === "DATE" ? "DD/MM/AAAA" : isNumericType(column.type) ? "0" : "texto"}
                className="field-input w-full py-1 text-[13px]"
              />
            </div>
          )}
        </div>

          <div className="border-t border-neutral-200 p-2 dark:border-neutral-800">
            <div className="relative mb-1.5">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Pesquisar"
                className="w-full rounded border border-neutral-300 bg-white py-1 pr-7 pl-2 text-[13px] text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-[var(--xl)] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              />
              <Search className="pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
            </div>
            <div className="h-48 overflow-auto rounded border border-neutral-300 bg-white py-0.5 dark:border-neutral-700 dark:bg-neutral-900">
              {error ? (
                <p className="p-2 text-xs text-red-600 dark:text-red-400">{error}</p>
              ) : !groups ? (
                <div className="flex h-full items-center justify-center">
                  <LoadingDots />
                </div>
              ) : (
                <>
                  <CheckRow checked={allVisibleChecked} indeterminate={!allVisibleChecked && visible.some((g) => isChecked(g.key))} onChange={toggleAllVisible}>
                    {query.trim() ? "(Selecionar Todos os Resultados da Pesquisa)" : "(Selecionar Tudo)"}
                  </CheckRow>
                  {visible.map((g) => (
                    <CheckRow key={g.key} checked={isChecked(g.key)} onChange={() => toggle(g.key)} count={g.count}>
                      {g.label}
                    </CheckRow>
                  ))}
                  {groups.length >= 500 && <p className="px-2 py-1 text-[11px] text-neutral-400">Mostrando os 500 valores mais frequentes.</p>}
                </>
              )}
            </div>
          </div>

        <div className="flex justify-end gap-2 border-t border-neutral-200 bg-neutral-50 px-2 py-2 dark:border-neutral-800 dark:bg-neutral-800/40">
          <button
            type="button"
            onClick={apply}
            disabled={!groups && !customOpen}
            className="min-w-20 rounded border border-[var(--xl-btn-hover)] bg-[var(--xl-btn)] px-3 py-1 text-[13px] font-medium text-white hover:bg-[var(--xl-btn-hover)] disabled:opacity-50"
          >
            OK
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-w-20 rounded border border-neutral-300 bg-white px-3 py-1 text-[13px] text-neutral-800 hover:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function MenuRow({ icon: Icon, children, onClick, disabled, active }: { icon: typeof Search; children: React.ReactNode; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[var(--xl-soft)] disabled:pointer-events-none disabled:opacity-40 ${
        active ? "font-semibold text-[var(--xl)]" : "text-neutral-800 dark:text-neutral-200"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0 text-neutral-500" />
      <span className="truncate">{children}</span>
    </button>
  );
}

function CheckRow({
  checked,
  indeterminate,
  onChange,
  count,
  children,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 px-2 py-[3px] hover:bg-[var(--xl-soft)]">
      <input
        type="checkbox"
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate;
        }}
        onChange={onChange}
        className="h-3.5 w-3.5 shrink-0 accent-[var(--xl)]"
      />
      <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-200">{children}</span>
      {count !== undefined && <span className="shrink-0 text-[11px] text-neutral-400 tabular-nums">{count}</span>}
    </label>
  );
}
