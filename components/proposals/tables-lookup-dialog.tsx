"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronRight, ChevronUp, Loader2, Minus, Plus, Printer, Save, Search, Trash2, X } from "lucide-react";
import type { ServopaTableListView, ServopaTableView } from "@/lib/servopa-tables/queries";
import { toUnits } from "@/lib/servopa-tables/adjust";
import { formatBRL, formatDateBR, formatPercent, SEGMENT_LABEL } from "@/lib/servopa-tables/format";
import { splitContemplationText } from "@/lib/servopa-tables/contemplation";
import {
  calcularParcelaInicial,
  calcularSomaPorGrupo,
  calcularTaxaTotal,
  totalizarQuotas,
  type AdheredQuota,
} from "@/lib/proposals/quotas";

/** Altura (px) do painel "Ajustar cotas": cresce com os créditos até um teto, e rola por dentro. */
/** A barra de resumo é um cartão à parte, abaixo da janela; GAP_PX é o respiro entre os elementos. */
const BAR_PX = 68;
const GAP_PX = 12;
const ADJUST_ROW_PX = 64;
const ADJUST_HEAD_PX = 56;
const ADJUST_MAX_PX = 280;
function adjustPanelHeight(count: number) {
  return Math.min(ADJUST_HEAD_PX + count * ADJUST_ROW_PX, ADJUST_MAX_PX);
}

/** Como a lista chega pelo JSON: as datas viram texto na serialização. */
type TableRow = Omit<ServopaTableListView, "nextAssemblyAt"> & { nextAssemblyAt: string | null };

/** Idem para a tabela aberta: `rows` é o que o "Ver" mostra. */
type TableDetailView = Omit<ServopaTableView, "nextAssemblyAt" | "adjustedAt" | "lastChangedAt"> & {
  nextAssemblyAt: string | null;
};

type Filters = { grupo: string; segmento: string; prazo: string; taxa: string };

const EMPTY_FILTERS: Filters = { grupo: "", segmento: "", prazo: "", taxa: "" };

/**
 * GET da mesma lista que /tabelas mostra. Fica aqui (e não no componente) para
 * deixar claro que a tela só lê: nada daqui altera tabela.
 */
async function fetchTables(signal: AbortSignal): Promise<{ tables: TableRow[]; lastSyncAt: string | null }> {
  const res = await fetch("/api/tabelas", { signal, headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Não foi possível carregar as tabelas.");
  }
  return res.json();
}

/**
 * Conteúdo (não um Modal): substitui o painel da proposta enquanto a consulta
 * está aberta, em vez de empilhar um segundo modal por cima. `onBack` devolve
 * o formulário — que continua montado, com tudo que já foi digitado.
 */
export function TablesLookupPanel({
  onBack,
  onClose,
  quotas,
  onQuotasChange,
  onSaveQuotas,
}: {
  onBack: () => void;
  onClose: () => void;
  quotas: AdheredQuota[];
  onQuotasChange: (quotas: AdheredQuota[]) => void;
  onSaveQuotas: () => void;
}) {
  const [data, setData] = useState<{ tables: TableRow[]; lastSyncAt: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  /** Tabela aberta no "Ver". A lista continua montada atrás, com filtros intactos. */
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let done = false;
    fetchTables(controller.signal)
      .then((loaded) => {
        done = true;
        setData(loaded);
      })
      .catch((err: unknown) => {
        done = true;
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Não foi possível carregar as tabelas.");
      });
    // Com MOTIVO e só se ainda estiver em voo: `abort()` pelado vira
    // "signal is aborted without reason" no painel de erro do dev (o
    // StrictMode monta, desmonta e monta de novo, então sempre acontece).
    return () => {
      if (!done) controller.abort(new DOMException("Consulta de tabelas cancelada: o modal fechou.", "AbortError"));
    };
  }, [attempt]);

  const tables = data?.tables;
  const terms = useMemo(
    () => [...new Set(tables?.map((t) => t.termMonths) ?? [])].sort((a, b) => a - b),
    [tables],
  );
  const rates = useMemo(
    () => [...new Set(tables?.map((t) => t.admEffective) ?? [])].sort((a, b) => toUnits(a, 4) - toUnits(b, 4)),
    [tables],
  );

  const visible = useMemo(
    () =>
      (tables ?? [])
        .filter((t) => !filters.segmento || t.segment === filters.segmento)
        .filter((t) => !filters.grupo || t.groupNumber.startsWith(filters.grupo))
        .filter((t) => !filters.prazo || t.termMonths === Number(filters.prazo))
        .filter((t) => !filters.taxa || t.admEffective === filters.taxa),
    [tables, filters],
  );

  const hasFilters = Boolean(filters.grupo || filters.segmento || filters.prazo || filters.taxa);
  const loading = !data && !error;
  /** A barra de resumo fica sempre à vista; o ajuste de cotas só abre quando a pessoa pede. */
  const [cartOpen, setCartOpen] = useState(false);

  /** Espaço que o painel de ajuste ocupa embaixo; 0 com ele recolhido. O conteúdo de cima encolhe com transição. */
  const reserve = quotas.length === 0 ? 0 : BAR_PX + GAP_PX + (cartOpen ? adjustPanelHeight(quotas.length) + GAP_PX : 0);

  // A janela principal encolhe e sobe por esse tanto (ver proposal-form-dialog); os cartões ficam embaixo.
  useEffect(() => {
    document.documentElement.style.setProperty("--lookup-reserve", `${reserve}px`);
    return () => {
      document.documentElement.style.removeProperty("--lookup-reserve");
    };
  }, [reserve]);

  function toggleQuota(quota: AdheredQuota) {
    const already = quotas.some((q) => q.tableId === quota.tableId && q.category === quota.category);
    if (already) {
      // Último crédito removido: nada a ajustar. Recolhe, para o próximo anexo não abrir o painel já expandido.
      if (quotas.length === 1) setCartOpen(false);
      onQuotasChange(quotas.filter((q) => !(q.tableId === quota.tableId && q.category === quota.category)));
      return;
    }
    onQuotasChange([...quotas, quota]);
  }

  function setCotas(tableId: string, category: string, cotas: number) {
    onQuotasChange(quotas.map((q) => (q.tableId === tableId && q.category === category ? { ...q, cotas } : q)));
  }

  return (
    <>
      <div className="-m-5 mb-0 border-b border-neutral-200 bg-white/80 px-5 py-3 dark:border-neutral-800 dark:bg-neutral-950/40">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            {/* Uma seta só: no detalhe volta para a lista, na lista volta para a proposta. */}
            <button
              type="button"
              onClick={() => (detailId ? setDetailId(null) : onBack())}
              className="btn-ghost btn-sm mt-0.5 shrink-0"
              aria-label={detailId ? "Voltar para as tabelas" : "Voltar para a proposta"}
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={2} />
            </button>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand dark:text-brand-light">Anexar à proposta</p>
              <h2 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                Créditos da Servopa
              </h2>
              <p className="mt-0.5 max-w-2xl text-sm leading-5 text-neutral-500 dark:text-neutral-400">
                {detailId
                  ? "Veja as categorias do grupo e use Anexar para levar o crédito escolhido à proposta."
                  : "Escolha o grupo e a categoria do crédito. Prazo, parcela e taxa vêm direto das tabelas da Servopa."}
                {!detailId && data?.lastSyncAt && ` Atualizada em ${formatDateBR(new Date(data.lastSyncAt))}.`}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setCartOpen((open) => !open)}
              disabled={quotas.length === 0}
              className={quotas.length > 0 ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
              aria-expanded={cartOpen}
            >
              Anexados
              <span className="rounded-full bg-black/15 px-1.5 text-xs tabular-nums dark:bg-white/15">{quotas.length}</span>
            </button>
            <button type="button" onClick={onClose} className="icon-btn h-8 w-8 shrink-0" aria-label="Fechar">
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>

      {detailId && <TableDetail id={detailId} quotas={quotas} onToggle={toggleQuota} reserve={reserve} />}

      {!detailId && loading && (
        <div className="flex items-center justify-center gap-2.5 py-20 text-sm text-neutral-500 dark:text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
          Carregando as tabelas…
        </div>
      )}

      {!detailId && error && (
        <div className="py-16 text-center">
          <AlertTriangle className="mx-auto h-7 w-7 text-amber-500" strokeWidth={1.8} />
          <p className="mt-2 text-sm font-medium text-neutral-800 dark:text-neutral-200">{error}</p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
            className="btn-secondary btn-sm mt-3"
          >
            Tentar de novo
          </button>
        </div>
      )}

      {!detailId && tables && (
        <div className="space-y-4 pt-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="relative min-w-0 flex-1 basis-full sm:basis-56">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
              <input
                id="lookup-grupo"
                inputMode="numeric"
                value={filters.grupo}
                onChange={(e) => setFilters((f) => ({ ...f, grupo: e.target.value.replace(/\D/g, "") }))}
                placeholder="Buscar pelo número do grupo"
                aria-label="Buscar pelo número do grupo"
                className="field-input h-10 pl-10 pr-9"
              />
              {filters.grupo && (
                <button type="button" onClick={() => setFilters((f) => ({ ...f, grupo: "" }))} className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800" aria-label="Limpar busca">
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
            <div role="group" aria-label="Segmento" className="flex items-center gap-5">
              {[{ value: "", label: "Todos" }, { value: "REAL_ESTATE", label: "Imóveis" }, { value: "MOVABLE", label: "Móveis" }].map((item) => {
                const active = filters.segmento === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setFilters((f) => ({ ...f, segmento: item.value }))}
                    aria-pressed={active}
                    className={`border-b-2 py-1.5 text-sm font-medium transition-colors ${active ? "border-brand text-neutral-900 dark:text-neutral-100" : "border-transparent text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"}`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
            <select id="lookup-prazo" aria-label="Prazo" value={filters.prazo} onChange={(e) => setFilters((f) => ({ ...f, prazo: e.target.value }))} className="field-input field-select h-10 w-full sm:w-40">
              <option value="">Todos os prazos</option>
              {terms.map((months) => <option key={months} value={months}>{months} meses</option>)}
            </select>
            <select id="lookup-taxa" aria-label="Taxa de administração" value={filters.taxa} onChange={(e) => setFilters((f) => ({ ...f, taxa: e.target.value }))} className="field-input field-select h-10 w-full sm:w-44">
              <option value="">Todas as taxas de ADM</option>
              {rates.map((rate) => <option key={rate} value={rate}>ADM {formatPercent(rate, { trim: true })}</option>)}
            </select>
            {hasFilters && (
              <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className="btn-ghost h-10" title="Limpar filtros">
                <X className="h-4 w-4" aria-hidden="true" />
                Limpar filtros
              </button>
            )}
          </div>

          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
              {visible.length === tables.length ? `${tables.length} tabelas` : `${visible.length} de ${tables.length} tabelas`}
            </p>
            <p className="text-xs text-neutral-400">Clique no grupo para ver os créditos e anexar à proposta</p>
          </div>

          {visible.length === 0 ? (
            <div className="border-y border-neutral-200 py-12 text-center text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
              Nenhuma tabela com esses filtros.
            </div>
          ) : (
            <div style={{ maxHeight: `calc(100vh - 16rem - ${reserve}px)` }} className="scrollbar-thin overflow-auto border-y transition-[max-height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] border-neutral-200 dark:border-neutral-800">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="sticky top-0 z-10 bg-white dark:bg-neutral-900">
                  <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-[0.14em] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                    <th className="px-3 py-3 font-medium">Grupo</th>
                    <th className="px-3 py-3 font-medium">Segmento</th>
                    <th className="px-3 py-3 font-medium">Prazo</th>
                    <th className="px-3 py-3 font-medium">ADM</th>
                    <th className="px-3 py-3 font-medium">Crédito</th>
                    <th className="px-3 py-3 font-medium">Parcela</th>
                    <th className="px-3 py-3 font-medium">Vagas</th>
                    <th className="px-3 py-3 font-medium">Assembleia</th>
                    <th className="px-3 py-3"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/70">
                  {visible.map((table) => {
                    const low = table.vacancies !== null && table.vacancies <= 20;
                    return (
                      <tr
                        key={table.id}
                        onClick={(event) => {
                          if ((event.target as HTMLElement).closest("a, button")) return;
                          setDetailId(table.id);
                        }}
                        className="group cursor-pointer transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                      >
                        <td className="whitespace-nowrap px-3 py-3 text-[15px] font-semibold text-neutral-900 group-hover:text-brand dark:text-neutral-100">Grupo {table.groupNumber}</td>
                        <td className="px-3 py-3">
                          <span className="inline-flex items-center gap-2 whitespace-nowrap text-neutral-700 dark:text-neutral-200">
                            <span className={`h-2 w-2 rounded-full ${table.segment === "REAL_ESTATE" ? "bg-emerald-500" : "bg-sky-500"}`} aria-hidden="true" />
                            {SEGMENT_LABEL[table.segment]}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 tabular-nums text-neutral-600 dark:text-neutral-300">{table.termMonths} meses</td>
                        <td className="px-3 py-3 font-medium tabular-nums text-neutral-900 dark:text-neutral-100">{formatPercent(table.admEffective, { trim: true })}</td>
                        <td className="px-3 py-3"><MoneyRange range={table.creditRange} /></td>
                        <td className="px-3 py-3"><MoneyRange range={table.installmentRange} /></td>
                        <td className={`whitespace-nowrap px-3 py-3 tabular-nums ${low ? "font-semibold text-amber-600 dark:text-amber-400" : "text-neutral-700 dark:text-neutral-200"}`}>
                          {table.vacancies === null ? "—" : `${table.vacancies} ${table.vacancies === 1 ? "vaga" : "vagas"}`}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 tabular-nums text-neutral-600 dark:text-neutral-300">
                          {table.nextAssemblyAt ? formatDateBR(new Date(table.nextAssemblyAt)) : "—"}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* O PDF é uma folha pronta para impressão; aí sim, aba nova. */}
                            <Link href={`/tabela-servopa/${table.id}`} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm" title="Gerar PDF desta tabela">
                              <Printer className="h-4 w-4" />PDF
                            </Link>
                            <ChevronRight className="h-4 w-4 text-neutral-300 transition-transform group-hover:translate-x-0.5 group-hover:text-neutral-500" aria-hidden="true" />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {quotas.length > 0 && (
        <QuotasCart
          quotas={quotas}
          expanded={cartOpen}
          panelHeight={adjustPanelHeight(quotas.length)}
          onToggle={() => setCartOpen((open) => !open)}
          onCotasChange={setCotas}
          onRemove={toggleQuota}
          onSave={onSaveQuotas}
        />
      )}
    </>
  );
}

/**
 * Os créditos já anexados. Fica numa barra baixa, sempre à vista, para não cobrir
 * a tabela; o ajuste de cotas de cada um abre acima dela só quando a pessoa pede.
 */
function QuotasCart({
  quotas,
  expanded,
  panelHeight,
  onToggle,
  onCotasChange,
  onRemove,
  onSave,
}: {
  quotas: AdheredQuota[];
  expanded: boolean;
  panelHeight: number;
  onToggle: () => void;
  onCotasChange: (tableId: string, category: string, cotas: number) => void;
  onRemove: (quota: AdheredQuota) => void;
  onSave: () => void;
}) {
  const totals = totalizarQuotas(quotas);
  const clamp = (value: number) => Math.max(1, Math.min(99, value || 1));
  const panel = "bg-white shadow-[0_18px_48px_-12px_rgba(0,0,0,0.4)] ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-700";

  // Portal no <body>: o painel da janela tem backdrop-filter, que prende `fixed` dentro dele. Fora, os cartões são elementos à parte.
  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <aside
        aria-hidden={!expanded}
        style={{ height: expanded ? panelHeight : 0 }}
        className={`fixed bottom-[5.5rem] left-1/2 z-[59] w-[min(80rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl transition-[height,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${panel} ${expanded ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <div className="flex h-full flex-col" style={{ height: panelHeight }}>
          <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Ajustar cotas</h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Defina quantas cotas de cada crédito entram na proposta.</p>
            </div>
            <button type="button" onClick={onToggle} className="icon-btn h-7 w-7 shrink-0" aria-label="Recolher" tabIndex={expanded ? 0 : -1}>
              <ChevronDown className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          <ul className="scrollbar-thin min-h-0 flex-1 divide-y divide-neutral-100 overflow-auto px-4 dark:divide-neutral-800">
            {quotas.map((q) => (
              <li key={`${q.tableId}-${q.category}`} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-2.5">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    Grupo {q.groupNumber} <span className="font-normal text-neutral-400">·</span> Categoria {q.category}
                  </p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {q.termMonths} meses · taxa total {formatPercent(calcularTaxaTotal(q.admEffective, q.reserveFundPercent), { trim: true })}
                  </p>
                </div>

                <div className="inline-flex shrink-0 items-center border border-neutral-200 dark:border-neutral-700">
                  <button
                    type="button"
                    onClick={() => onCotasChange(q.tableId, q.category, clamp(q.cotas - 1))}
                    disabled={q.cotas <= 1}
                    tabIndex={expanded ? 0 : -1}
                    className="flex h-8 w-8 items-center justify-center text-neutral-500 transition-colors hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
                    aria-label="Diminuir cotas"
                  >
                    <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={q.cotas}
                    tabIndex={expanded ? 0 : -1}
                    onChange={(e) => onCotasChange(q.tableId, q.category, clamp(Number(e.target.value)))}
                    className="h-8 w-10 border-x border-neutral-200 bg-transparent text-center text-sm font-semibold tabular-nums text-neutral-900 outline-none [appearance:textfield] dark:border-neutral-700 dark:text-neutral-100 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    aria-label={`Quantidade de cotas do grupo ${q.groupNumber} categoria ${q.category}`}
                  />
                  <button
                    type="button"
                    onClick={() => onCotasChange(q.tableId, q.category, clamp(q.cotas + 1))}
                    disabled={q.cotas >= 99}
                    tabIndex={expanded ? 0 : -1}
                    className="flex h-8 w-8 items-center justify-center text-neutral-500 transition-colors hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
                    aria-label="Aumentar cotas"
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </button>
                </div>

                <div className="w-32 text-right">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-neutral-400">Crédito</p>
                  <p className="whitespace-nowrap text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{formatBRL(calcularSomaPorGrupo(q.cotas, q.creditValue))}</p>
                </div>
                <div className="w-32 text-right">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-neutral-400">Parcela/mês</p>
                  <p className="whitespace-nowrap text-sm font-semibold tabular-nums text-brand">{formatBRL(calcularParcelaInicial(q.cotas, q.installment))}</p>
                </div>

                <button
                  type="button"
                  onClick={() => onRemove(q)}
                  tabIndex={expanded ? 0 : -1}
                  className="icon-btn h-7 w-7 shrink-0 text-neutral-400 hover:text-red-600"
                  aria-label={`Remover grupo ${q.groupNumber} categoria ${q.category}`}
                  title="Remover"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <div className={`fixed bottom-2 left-1/2 z-[60] flex h-[68px] w-[min(80rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-x-6 overflow-hidden rounded-xl px-5 ${panel}`}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="group flex items-center gap-2 text-left"
          title="Ajustar a quantidade de cotas"
        >
          <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {quotas.length} {quotas.length === 1 ? "crédito anexado" : "créditos anexados"}
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-brand">
            Ajustar cotas
            <ChevronUp className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} strokeWidth={2.5} />
          </span>
        </button>

        <dl className="ml-auto flex items-baseline gap-x-6">
          <div className="hidden items-baseline gap-2 sm:flex">
            <dt className="text-xs text-neutral-500 dark:text-neutral-400">Cotas</dt>
            <dd className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{totals.cotas}</dd>
          </div>
          <div className="hidden items-baseline gap-2 md:flex">
            <dt className="text-xs text-neutral-500 dark:text-neutral-400">Crédito total</dt>
            <dd className="whitespace-nowrap text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{formatBRL(totals.credito)}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-xs text-neutral-500 dark:text-neutral-400">Parcela por mês</dt>
            <dd className="whitespace-nowrap text-base font-semibold tabular-nums text-brand">{formatBRL(totals.parcela)}</dd>
          </div>
        </dl>

        {/* Form próprio: o "salvar" das cotas não é o submit da proposta. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
        >
          <button type="submit" className="btn-primary" title="Preenche crédito, cotas, prazo, taxa e parcela da proposta">
            <Save className="h-4 w-4" strokeWidth={2} />
            Usar na proposta
          </button>
        </form>
      </div>
    </>,
    document.body,
  );
}

/** O mesmo conteúdo de /tabelas/[id], dentro do modal. */
function TableDetail({
  id,
  quotas,
  onToggle,
  reserve,
}: {
  id: string;
  quotas: AdheredQuota[];
  onToggle: (quota: AdheredQuota) => void;
  reserve: number;
}) {
  const [table, setTable] = useState<TableDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let done = false;
    fetch(`/api/tabelas/${id}`, { signal: controller.signal, headers: { Accept: "application/json" } })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { table?: TableDetailView; error?: string } | null;
        done = true;
        if (!res.ok || !body?.table) throw new Error(body?.error ?? "Não foi possível carregar a tabela.");
        setTable(body.table);
      })
      .catch((err: unknown) => {
        done = true;
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Não foi possível carregar a tabela.");
      });
    // Mesmo cuidado da lista: cancelar com motivo, e só se ainda estiver em voo.
    return () => {
      if (!done) controller.abort(new DOMException("Consulta da tabela cancelada: você saiu do grupo.", "AbortError"));
    };
  }, [id, attempt]);

  if (error) {
    return (
      <div className="py-16 text-center">
        <AlertTriangle className="mx-auto h-7 w-7 text-amber-500" strokeWidth={1.8} />
        <p className="mt-2 text-sm font-medium text-neutral-800 dark:text-neutral-200">{error}</p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
          className="btn-secondary btn-sm mt-3"
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  if (!table) {
    return (
      <div className="flex items-center justify-center gap-2.5 py-20 text-sm text-neutral-500 dark:text-neutral-400">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
        Carregando a tabela…
      </div>
    );
  }

  const adjusted = toUnits(table.adjustmentPoints, 4) !== 0;
  const blocks = table.contemplationText ? splitContemplationText(table.contemplationText) : [];
  const real = table.segment === "REAL_ESTATE";
  const low = table.vacancies !== null && table.vacancies <= 20;

  return (
    <div style={{ maxHeight: `calc(100vh - 9rem - ${reserve}px)` }} className="scrollbar-thin space-y-6 overflow-y-auto pr-1 pt-5 transition-[max-height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-500 dark:text-neutral-400">Grupo</p>
          <p className="text-5xl font-semibold leading-none tracking-tight text-neutral-900 dark:text-neutral-100">{table.groupNumber}</p>
          <p className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-neutral-600 dark:text-neutral-300">
            <span className="inline-flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${real ? "bg-emerald-500" : "bg-sky-500"}`} aria-hidden="true" />
              {SEGMENT_LABEL[table.segment]}
            </span>
            <span className="text-neutral-300 dark:text-neutral-600" aria-hidden="true">/</span>
            <span>{table.termMonths} meses</span>
            <span className="text-neutral-300 dark:text-neutral-600" aria-hidden="true">/</span>
            <span>Taxa de ADM {formatPercent(table.admEffective, { trim: true })}</span>
          </p>
        </div>
        <Link href={`/tabela-servopa/${table.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-3 bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand dark:bg-white dark:text-neutral-900 dark:hover:bg-brand dark:hover:text-white">
          <Printer className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          Gerar PDF desta tabela
        </Link>
      </div>

      <dl className="grid grid-cols-2 gap-x-5 border-y border-neutral-200 sm:grid-cols-5 dark:border-neutral-800">
        <DetailInfo label="Taxa de ADM" note={adjusted ? `Servopa: ${formatPercent(table.admOriginal, { trim: true })}` : undefined}>
          {formatPercent(table.admEffective, { trim: true })}
        </DetailInfo>
        <DetailInfo label="Fundo de reserva">{table.reserveFundPercent ? formatPercent(table.reserveFundPercent, { trim: true }) : "—"}</DetailInfo>
        <DetailInfo label="Próxima assembleia" note={table.nextAssemblyNumber ? `${table.nextAssemblyNumber}ª assembleia` : undefined}>
          {table.nextAssemblyAt ? formatDateBR(new Date(table.nextAssemblyAt)) : "—"}
        </DetailInfo>
        <DetailInfo label="Vencimento">{table.dueDay ? `Dia ${table.dueDay}` : "—"}</DetailInfo>
        <DetailInfo label="Vagas" note={low ? "Poucas vagas" : undefined}>
          <span className={low ? "text-amber-600 dark:text-amber-400" : ""}>{table.vacancies === null ? "—" : table.vacancies}</span>
        </DetailInfo>
      </dl>

      <section>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-base font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Categorias e parcelas</h3>
          <p className="text-xs text-neutral-400">Anexe as categorias que entram na proposta</p>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="sticky top-0 z-10 bg-white dark:bg-neutral-900">
              <tr className="border-b-2 border-neutral-900 text-left text-[11px] uppercase tracking-[0.14em] text-neutral-500 dark:border-neutral-100 dark:text-neutral-400">
                <th className="py-2.5 pr-3 font-medium">Cat.</th>
                <th className="px-3 py-2.5 text-right font-medium">Valor do bem</th>
                <th className="px-3 py-2.5 text-right font-medium">Contribuição mensal</th>
                <th className="px-3 py-2.5 text-right font-medium">Parcela</th>
                <th className="px-3 py-2.5 text-right font-medium">Seguro</th>
                <th className="px-3 py-2.5 text-right font-medium">Total</th>
                <th className="py-2.5 pl-3 text-right font-medium"><span className="sr-only">Anexar à proposta</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {table.rows.map((r) => {
                const adhered = quotas.some((q) => q.tableId === table.id && q.category === r.category);
                return (
                  <tr key={r.category} className={adhered ? "bg-brand-light/30 dark:bg-brand-light/10" : "transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/30"}>
                    <td className="py-3 pr-3 font-semibold text-neutral-900 dark:text-neutral-100">{r.category}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-base font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{formatBRL(r.creditValue)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-neutral-500 dark:text-neutral-400">{formatPercent(r.monthlyPercent)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-neutral-700 dark:text-neutral-200">{formatBRL(r.installment)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-neutral-500 dark:text-neutral-400">{formatBRL(r.insurance)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-base font-semibold tabular-nums text-brand">{formatBRL(r.total)}</td>
                    <td className="py-2 pl-3 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          onToggle({
                            tableId: table.id,
                            groupNumber: table.groupNumber,
                            termMonths: table.termMonths,
                            admEffective: table.admEffective,
                            // Do GRUPO, não da linha: é o que soma com a ADM na taxa da tabela.
                            reserveFundPercent: table.reserveFundPercent,
                            category: r.category,
                            creditValue: r.creditValue,
                            installment: r.installment,
                            cotas: 1,
                          })
                        }
                        className={adhered ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
                        aria-pressed={adhered}
                      >
                        {adhered ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <Plus className="h-4 w-4" strokeWidth={2.5} />}
                        {adhered ? "Anexada" : "Anexar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {blocks.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between gap-3 border-b border-neutral-200 pb-3 dark:border-neutral-800">
            <h3 className="text-base font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Regras do grupo</h3>
            <p className="text-xs text-neutral-400">Texto publicado pela Servopa</p>
          </div>
          <div className="mt-4 grid gap-x-8 gap-y-5 md:grid-cols-2">
            {blocks.map((block, index) => block.kind === "list" ? (
              <div key={index}>
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-900 dark:text-neutral-100">{block.title.replace(/:$/, "")}</h4>
                {block.items.length > 0 && (
                  <ol className="mt-2 divide-y divide-neutral-100 border-t border-neutral-200 dark:divide-neutral-800/70 dark:border-neutral-800">
                    {block.items.map((item, i) => (
                      <li key={i} className="flex gap-4 py-2 text-sm text-neutral-600 dark:text-neutral-300">
                        <span className="w-5 shrink-0 tabular-nums text-neutral-400">{String(i + 1).padStart(2, "0")}</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ) : (
              <p key={index} className="border-t border-neutral-200 pt-2 text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-300">{block.text}</p>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DetailInfo({ label, children, note }: { label: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="min-w-0 py-4 sm:border-l sm:border-neutral-200 sm:pl-5 sm:first:border-l-0 sm:first:pl-0 dark:sm:border-neutral-800">
      <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd className="mt-1.5 text-xl font-semibold leading-none tracking-tight tabular-nums text-neutral-900 dark:text-neutral-100">{children}</dd>
      {note && <p className="mt-1.5 text-xs text-neutral-400">{note}</p>}
    </div>
  );
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
