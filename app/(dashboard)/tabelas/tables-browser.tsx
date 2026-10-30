"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarDays, CheckSquare2, Eye, MinusSquare, Percent, Printer, Square, X, ChevronRight } from "lucide-react";
import type { ServopaTableListView } from "@/lib/servopa-tables/queries";
import { toUnits } from "@/lib/servopa-tables/adjust";
import { formatBRL, formatDateBR, formatPercent, SEGMENT_LABEL } from "@/lib/servopa-tables/format";
import { TableFilters, type TableFilterState } from "./table-filters";
import { AdjustTablesDialog } from "./adjust-tables-dialog";

export type TableSortKey = "grupo" | "segmento" | "prazo" | "taxa" | "credito" | "parcela" | "vagas" | "assembleia";
export type TableSortOrder = "asc" | "desc";

export type TableBrowserInitialState = TableFilterState & {
  ordenar: TableSortKey;
  ordem: TableSortOrder;
};

function compareTables(a: ServopaTableListView, b: ServopaTableListView, key: TableSortKey): number {
  switch (key) {
    case "grupo": return Number(a.groupNumber) - Number(b.groupNumber);
    case "segmento": return SEGMENT_LABEL[a.segment].localeCompare(SEGMENT_LABEL[b.segment], "pt-BR");
    case "prazo": return a.termMonths - b.termMonths;
    case "taxa": return toUnits(a.admEffective, 4) - toUnits(b.admEffective, 4);
    case "credito": return toUnits(a.creditRange.min, 2) - toUnits(b.creditRange.min, 2);
    case "parcela": return toUnits(a.installmentRange.min, 2) - toUnits(b.installmentRange.min, 2);
    case "vagas": return (a.vacancies ?? 0) - (b.vacancies ?? 0);
    case "assembleia": {
      if (!a.nextAssemblyAt) return b.nextAssemblyAt ? 1 : 0;
      if (!b.nextAssemblyAt) return -1;
      return new Date(a.nextAssemblyAt).getTime() - new Date(b.nextAssemblyAt).getTime();
    }
  }
}

function MoneyRange({ range }: { range: { min: string; max: string } }) {
  if (range.min === range.max) return <span className="whitespace-nowrap tabular-nums">{formatBRL(range.min)}</span>;
  return (
    <div className="leading-5 tabular-nums">
      <div className="whitespace-nowrap font-medium text-neutral-900 dark:text-neutral-100">{formatBRL(range.min)}</div>
      <div className="whitespace-nowrap text-xs text-neutral-400">até {formatBRL(range.max)}</div>
    </div>
  );
}

function Rate({ table }: { table: ServopaTableListView }) {
  const adjusted = toUnits(table.adjustmentPoints, 4) !== 0;
  return (
    <div className="tabular-nums">
      <span className="font-medium text-neutral-900 dark:text-neutral-100">{formatPercent(table.admEffective, { trim: true })}</span>
      {adjusted && <span className="ml-1.5 text-xs text-neutral-400 line-through">Original {formatPercent(table.admOriginal, { trim: true })}</span>}
    </div>
  );
}

function SelectAllCheckbox({ checked, indeterminate, onChange }: { checked: boolean; indeterminate: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} className="h-4 w-4 accent-indigo-600" aria-label="Selecionar todas as tabelas filtradas" />;
}

function SegmentBadge({ segment }: { segment: ServopaTableListView["segment"] }) {
  const real = segment === "REAL_ESTATE";
  return (
    <span className="inline-flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
      <span className={`h-2 w-2 rounded-full ${real ? "bg-emerald-500" : "bg-sky-500"}`} />
      {SEGMENT_LABEL[segment]}
    </span>
  );
}

function Vacancies({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-neutral-400">Não informado</span>;
  const low = value <= 20;
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap text-sm tabular-nums ${low ? "font-semibold text-amber-600 dark:text-amber-400" : "text-neutral-700 dark:text-neutral-200"}`}>
      {value} {value === 1 ? "vaga" : "vagas"}
    </span>
  );
}

function SortHeader({ label, sortKey, activeKey, order, onSort }: {
  label: string;
  sortKey: TableSortKey;
  activeKey: TableSortKey;
  order: TableSortOrder;
  onSort: (key: TableSortKey) => void;
}) {
  const active = activeKey === sortKey;
  const Icon = active ? (order === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className="px-4 py-3 font-medium" aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1.5 whitespace-nowrap transition-colors hover:text-neutral-900 dark:hover:text-neutral-100">
        {label}
        <Icon className={`h-3.5 w-3.5 ${active ? "text-brand" : "text-neutral-400"}`} aria-hidden="true" />
      </button>
    </th>
  );
}

function writeUrl(state: TableBrowserInitialState) {
  const params = new URLSearchParams();
  if (state.segmento) params.set("segmento", state.segmento);
  if (state.grupo) params.set("grupo", state.grupo);
  if (state.prazo) params.set("prazo", state.prazo);
  if (state.taxa) params.set("taxa", state.taxa);
  if (state.ordenar !== "grupo") params.set("ordenar", state.ordenar);
  if (state.ordem !== "asc") params.set("ordem", state.ordem);
  window.history.replaceState(null, "", `/tabelas${params.size ? `?${params}` : ""}`);
}

export function TablesBrowser({ tables, initialState, canAdjust }: { tables: ServopaTableListView[]; initialState: TableBrowserInitialState; canAdjust: boolean }) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  /** Última tabela marcada: com Shift, o clique seguinte marca/desmarca o intervalo até ela. */
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const terms = useMemo(() => [...new Set(tables.map((table) => table.termMonths))].sort((a, b) => a - b), [tables]);
  const rates = useMemo(() => [...new Set(tables.map((table) => table.admEffective))].sort((a, b) => toUnits(a, 4) - toUnits(b, 4)), [tables]);

  const visible = useMemo(() => tables
    .filter((table) => !state.segmento || table.segment === state.segmento)
    .filter((table) => !state.grupo || table.groupNumber.startsWith(state.grupo))
    .filter((table) => !state.prazo || table.termMonths === Number(state.prazo))
    .filter((table) => !state.taxa || table.admEffective === state.taxa)
    .sort((a, b) => {
      if (state.ordenar === "assembleia" && !a.nextAssemblyAt !== !b.nextAssemblyAt) return a.nextAssemblyAt ? -1 : 1;
      if (state.ordenar === "vagas" && (a.vacancies === null) !== (b.vacancies === null)) return a.vacancies === null ? 1 : -1;
      const result = compareTables(a, b, state.ordenar);
      if (result !== 0) return state.ordem === "asc" ? result : -result;
      return Number(a.groupNumber) - Number(b.groupNumber) || toUnits(a.admOriginal, 4) - toUnits(b.admOriginal, 4);
    }), [tables, state]);

  function update(changes: Partial<TableBrowserInitialState>) {
    const next = { ...state, ...changes };
    if (["segmento", "grupo", "prazo", "taxa"].some((key) => key in changes)) clearSelection();
    setState(next);
    writeUrl(next);
  }

  function sort(key: TableSortKey) {
    update({ ordenar: key, ordem: state.ordenar === key && state.ordem === "asc" ? "desc" : "asc" });
  }

  const headers: Array<[string, TableSortKey]> = [
    ["Grupo", "grupo"], ["Segmento", "segmento"], ["Prazo", "prazo"], ["Taxa de ADM", "taxa"],
    ["Crédito", "credito"], ["Parcela", "parcela"], ["Vagas", "vagas"], ["Assembleia", "assembleia"],
  ];
  const selectedTables = useMemo(() => tables.filter((table) => selected.has(table.id)), [selected, tables]);
  const allVisibleSelected = visible.length > 0 && visible.every((table) => selected.has(table.id));
  const someVisibleSelected = visible.some((table) => selected.has(table.id));

  function clearSelection() {
    setSelected(new Set());
    setAnchorId(null);
  }

  /**
   * Mesmo comportamento da seleção de Clientes e Negócios: com Shift, marca (ou
   * desmarca) todas as tabelas entre a última clicada e esta, na ordem em que
   * aparecem na tela — já com filtros e ordenação aplicados.
   */
  function toggleOne(id: string, shiftKey = false) {
    const selecting = !selected.has(id);
    const currentIndex = visible.findIndex((table) => table.id === id);
    const anchorIndex = shiftKey && anchorId && anchorId !== id ? visible.findIndex((table) => table.id === anchorId) : -1;
    const ids = anchorIndex >= 0 && currentIndex >= 0
      ? visible.slice(Math.min(anchorIndex, currentIndex), Math.max(anchorIndex, currentIndex) + 1).map((table) => table.id)
      : [id];
    const next = new Set(selected);
    for (const tableId of ids) {
      if (selecting) next.add(tableId); else next.delete(tableId);
    }
    setSelected(next);
    if (selecting) setAnchorId(id);
    else if (anchorId === id) setAnchorId(null);
  }

  /** Clicar em qualquer ponto da linha abre a tabela (Ctrl/Cmd + clique, em nova aba); controles internos seguem com a ação própria. */
  function openRow(event: MouseEvent, id: string) {
    if ((event.target as HTMLElement).closest("a, button, input, label")) return;
    if (window.getSelection()?.toString()) return;
    if (event.ctrlKey || event.metaKey) window.open(`/tabelas/${id}`, "_blank");
    else router.push(`/tabelas/${id}`);
  }

  /** Shift + clique não pode selecionar o texto das linhas no meio do caminho. */
  function preventTextSelection(event: MouseEvent) {
    if (event.shiftKey) event.preventDefault();
  }

  function toggleVisible() {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visible.forEach((table) => next.delete(table.id));
      else visible.forEach((table) => next.add(table.id));
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <TableFilters filters={state} terms={terms} rates={rates} onChange={update} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">{visible.length === tables.length ? `${tables.length} tabelas` : `${visible.length} tabelas encontradas`}</p>
          {visible.length !== tables.length && <p className="text-xs text-neutral-400">de {tables.length}</p>}
        </div>
        {canAdjust && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={toggleVisible} className="btn-ghost btn-sm">
              {allVisibleSelected ? <CheckSquare2 className="h-4 w-4" /> : someVisibleSelected ? <MinusSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
              <span className="hidden sm:inline">{allVisibleSelected ? "Desmarcar resultados" : "Selecionar resultados"}</span>
              <span className="sm:hidden">{allVisibleSelected ? "Desmarcar" : "Selecionar"}</span>
            </button>
            {selectedTables.length > 0 && (
              <button type="button" onClick={clearSelection} title="Limpar seleção" className="btn-ghost btn-sm !px-2" aria-label="Limpar seleção">
                <X className="h-4 w-4" />
              </button>
            )}
            <button type="button" onClick={() => setAdjustOpen(true)} disabled={visible.length === 0 && selectedTables.length === 0} className="btn-primary btn-sm">
              <Percent className="h-4 w-4" />
              Ajustar taxas{selectedTables.length > 0 ? ` (${selectedTables.length})` : ""}
            </button>
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="card p-10 text-center text-sm text-neutral-500 dark:text-neutral-400">Nenhuma tabela com esses filtros.</div>
      ) : (
        <>
          <div className="hidden max-h-[calc(100vh-19rem)] overflow-auto border-y border-neutral-200 md:block dark:border-neutral-800">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="sticky top-0 z-10 bg-white dark:bg-neutral-900">
                <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                  {canAdjust && <th className="w-10 px-4 py-3"><SelectAllCheckbox checked={allVisibleSelected} indeterminate={someVisibleSelected && !allVisibleSelected} onChange={toggleVisible} /></th>}
                  {headers.map(([label, key]) => <SortHeader key={key} label={label} sortKey={key} activeKey={state.ordenar} order={state.ordem} onSort={sort} />)}
                  <th className="px-4 py-3 text-right font-medium"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/70">
                {visible.map((table) => (
                  <tr key={table.id} onClick={(event) => openRow(event, table.id)} className={`group cursor-pointer transition-colors ${selected.has(table.id) ? "bg-indigo-50/70 hover:bg-indigo-50 dark:bg-indigo-500/10 dark:hover:bg-indigo-500/15" : "hover:bg-neutral-50 dark:hover:bg-neutral-800/40"}`}>
                    {canAdjust && <td className="px-4 py-3"><input type="checkbox" checked={selected.has(table.id)} onClick={(event) => toggleOne(table.id, event.shiftKey)} onMouseDown={preventTextSelection} onChange={() => {}} className="h-4 w-4 accent-indigo-600" aria-label={`Selecionar tabela do grupo ${table.groupNumber}`} title="Shift + clique seleciona um intervalo" /></td>}
                    <td className="px-4 py-3.5"><Link href={`/tabelas/${table.id}`} className="text-[15px] font-semibold text-neutral-900 group-hover:text-brand dark:text-neutral-100">Grupo {table.groupNumber}</Link></td>
                    <td className="px-4 py-3"><SegmentBadge segment={table.segment} /></td>
                    <td className="px-4 py-3 tabular-nums text-neutral-600 dark:text-neutral-300">{table.termMonths} meses</td>
                    <td className="px-4 py-3"><Rate table={table} /></td>
                    <td className="px-4 py-3"><MoneyRange range={table.creditRange} /></td>
                    <td className="px-4 py-3"><MoneyRange range={table.installmentRange} /></td>
                    <td className="px-4 py-3"><Vacancies value={table.vacancies} /></td>
                    <td className="px-4 py-3 tabular-nums text-neutral-600 dark:text-neutral-300">{table.nextAssemblyAt ? formatDateBR(new Date(table.nextAssemblyAt)) : "—"}</td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-1.5">
                      <Link href={`/tabela-servopa/${table.id}`} target="_blank" className="btn-secondary btn-sm"><Printer className="h-4 w-4" />PDF</Link>
                      <ChevronRight className="my-auto h-4 w-4 text-neutral-300 transition-transform group-hover:translate-x-0.5 group-hover:text-neutral-500" aria-hidden="true" />
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden">
            {visible.map((table) => (
              <article key={table.id} onClick={(event) => openRow(event, table.id)} className={`cursor-pointer border-b border-neutral-200 py-4 transition-colors active:bg-neutral-50 dark:border-neutral-800 dark:active:bg-neutral-800/40 ${selected.has(table.id) ? "bg-indigo-50/60 dark:bg-indigo-500/10" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {canAdjust && <input type="checkbox" checked={selected.has(table.id)} onClick={(event) => toggleOne(table.id, event.shiftKey)} onChange={() => {}} className="mt-1 h-4 w-4 accent-indigo-600" aria-label={`Selecionar tabela do grupo ${table.groupNumber}`} />}
                    <div><Link href={`/tabelas/${table.id}`} className="text-base font-semibold">Grupo {table.groupNumber}</Link><div className="mt-1 flex items-center gap-2 text-sm text-neutral-500"><span>{SEGMENT_LABEL[table.segment]}</span><span>·</span><span>{table.termMonths} meses</span></div></div>
                  </div>
                  <Rate table={table} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-neutral-100 py-3 dark:border-neutral-800">
                  <div><dt className="mb-1 text-xs text-neutral-400">Crédito</dt><dd><MoneyRange range={table.creditRange} /></dd></div>
                  <div><dt className="mb-1 text-xs text-neutral-400">Parcela</dt><dd><MoneyRange range={table.installmentRange} /></dd></div>
                  <div><dt className="mb-1 text-xs text-neutral-400">Disponibilidade</dt><dd><Vacancies value={table.vacancies} /></dd></div>
                  <div><dt className="text-xs text-neutral-400">Próxima assembleia</dt><dd className="mt-0.5 flex items-center gap-1.5 text-sm tabular-nums"><CalendarDays className="h-3.5 w-3.5 text-neutral-400" />{table.nextAssemblyAt ? formatDateBR(new Date(table.nextAssemblyAt)) : "Não informada"}</dd></div>
                </dl>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Link href={`/tabelas/${table.id}`} className="btn-secondary"><Eye className="h-4 w-4" />Ver tabela</Link>
                  <Link href={`/tabela-servopa/${table.id}`} target="_blank" className="btn-primary"><Printer className="h-4 w-4" />Gerar PDF</Link>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {adjustOpen && (
        <AdjustTablesDialog
          selectedTables={selectedTables}
          filteredTables={visible}
          onClose={() => setAdjustOpen(false)}
          onApplied={() => {
            setAdjustOpen(false);
            clearSelection();
            if (state.taxa) update({ taxa: "" });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
