"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Check, Eye, Loader2, Plus, Printer, Save, Search, Trash2, X } from "lucide-react";
import type { ServopaTableListView, ServopaTableView } from "@/lib/servopa-tables/queries";
import { toUnits } from "@/lib/servopa-tables/adjust";
import { formatBRL, formatDateBR, formatPercent, SEGMENT_LABEL } from "@/lib/servopa-tables/format";
import {
  calcularParcelaInicial,
  calcularSomaPorGrupo,
  calcularTaxaTotal,
  totalizarQuotas,
  type AdheredQuota,
} from "@/lib/proposals/quotas";

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
  const openedTable = detailId ? tables?.find((t) => t.id === detailId) : undefined;
  /** O carrinho só abre sozinho na primeira adesão; depois quem manda é o botão. */
  const [cartOpen, setCartOpen] = useState(false);

  function toggleQuota(quota: AdheredQuota) {
    const already = quotas.some((q) => q.tableId === quota.tableId && q.category === quota.category);
    if (already) {
      onQuotasChange(quotas.filter((q) => !(q.tableId === quota.tableId && q.category === quota.category)));
      return;
    }
    onQuotasChange([...quotas, quota]);
    setCartOpen(true);
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
              <p className="text-xs font-semibold uppercase tracking-wide text-brand dark:text-brand-light">Consulta</p>
              <h2 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                {detailId ? `Grupo ${openedTable?.groupNumber ?? ""}` : "Tabelas Servopa"}
              </h2>
              <p className="mt-0.5 max-w-2xl text-sm leading-5 text-neutral-500 dark:text-neutral-400">
                {detailId
                  ? "Valor do bem, contribuição mensal, parcela e seguro por categoria."
                  : "Crédito, prazo e parcela por grupo e taxa de administração."}
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
              Aderidas
              <span className="rounded-full bg-black/15 px-1.5 text-xs tabular-nums dark:bg-white/15">{quotas.length}</span>
            </button>
            <button type="button" onClick={onClose} className="icon-btn h-8 w-8 shrink-0" aria-label="Fechar">
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>

      {detailId && <TableDetail id={detailId} quotas={quotas} onToggle={toggleQuota} />}

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
        <div className="space-y-3 pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-44">
              <label htmlFor="lookup-grupo" className="field-label">Grupo</label>
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
                <input
                  id="lookup-grupo"
                  inputMode="numeric"
                  value={filters.grupo}
                  onChange={(e) => setFilters((f) => ({ ...f, grupo: e.target.value.replace(/\D/g, "") }))}
                  placeholder="Buscar grupo"
                  className="field-input pl-9"
                />
              </div>
            </div>
            <div className="w-full sm:w-36">
              <label htmlFor="lookup-segmento" className="field-label">Segmento</label>
              <select
                id="lookup-segmento"
                value={filters.segmento}
                onChange={(e) => setFilters((f) => ({ ...f, segmento: e.target.value }))}
                className="field-input field-select mt-1"
              >
                <option value="">Todos</option>
                <option value="REAL_ESTATE">Imóvel</option>
                <option value="MOVABLE">Móvel</option>
              </select>
            </div>
            <div className="w-full sm:w-36">
              <label htmlFor="lookup-prazo" className="field-label">Prazo</label>
              <select
                id="lookup-prazo"
                value={filters.prazo}
                onChange={(e) => setFilters((f) => ({ ...f, prazo: e.target.value }))}
                className="field-input field-select mt-1"
              >
                <option value="">Todos</option>
                {terms.map((months) => <option key={months} value={months}>{months} meses</option>)}
              </select>
            </div>
            <div className="w-full sm:w-36">
              <label htmlFor="lookup-taxa" className="field-label">Taxa de ADM</label>
              <select
                id="lookup-taxa"
                value={filters.taxa}
                onChange={(e) => setFilters((f) => ({ ...f, taxa: e.target.value }))}
                className="field-input field-select mt-1"
              >
                <option value="">Todas</option>
                {rates.map((rate) => <option key={rate} value={rate}>{formatPercent(rate, { trim: true })}</option>)}
              </select>
            </div>
            {hasFilters && (
              <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className="btn-ghost" title="Limpar filtros">
                <X className="h-4 w-4" aria-hidden="true" />
                Limpar
              </button>
            )}
          </div>

          <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
            {visible.length === tables.length ? `${tables.length} tabelas` : `${visible.length} de ${tables.length} tabelas`}
          </p>

          {visible.length === 0 ? (
            <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
              Nenhuma tabela com esses filtros.
            </div>
          ) : (
            <div className="scrollbar-thin max-h-[48vh] overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
              <table className="w-full min-w-[840px] text-sm">
                <thead className="sticky top-0 z-10 bg-white dark:bg-neutral-900">
                  <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                    <th className="px-3 py-2.5 font-medium">Grupo</th>
                    <th className="px-3 py-2.5 font-medium">Segmento</th>
                    <th className="px-3 py-2.5 font-medium">Prazo</th>
                    <th className="px-3 py-2.5 font-medium">Taxa de ADM</th>
                    <th className="px-3 py-2.5 font-medium">Crédito</th>
                    <th className="px-3 py-2.5 font-medium">Parcela</th>
                    <th className="px-3 py-2.5 font-medium">Vagas</th>
                    <th className="px-3 py-2.5 font-medium">Assembleia</th>
                    <th className="px-3 py-2.5 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/70">
                  {visible.map((table) => (
                    <tr key={table.id} className="transition-colors hover:bg-neutral-50/70 dark:hover:bg-neutral-800/30">
                      <td className="px-3 py-2.5 font-medium text-neutral-900 dark:text-neutral-100">Grupo {table.groupNumber}</td>
                      <td className="px-3 py-2.5">
                        <span className="rounded bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                          {SEGMENT_LABEL[table.segment]}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-neutral-600 dark:text-neutral-300">{table.termMonths} meses</td>
                      <td className="px-3 py-2.5 font-medium tabular-nums text-neutral-900 dark:text-neutral-100">
                        {formatPercent(table.admEffective, { trim: true })}
                      </td>
                      <td className="px-3 py-2.5"><MoneyRange range={table.creditRange} /></td>
                      <td className="px-3 py-2.5"><MoneyRange range={table.installmentRange} /></td>
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-neutral-600 dark:text-neutral-300">
                        {table.vacancies === null ? "—" : `${table.vacancies} ${table.vacancies === 1 ? "vaga" : "vagas"}`}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-neutral-600 dark:text-neutral-300">
                        {table.nextAssemblyAt ? formatDateBR(new Date(table.nextAssemblyAt)) : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1.5">
                          {/* Troca o conteúdo do modal, em vez de navegar: a proposta em edição fica intacta. */}
                          <button type="button" onClick={() => setDetailId(table.id)} className="btn-ghost btn-sm">
                            <Eye className="h-4 w-4" />Ver
                          </button>
                          {/* O PDF é uma folha pronta para impressão; aí sim, aba nova. */}
                          <Link href={`/tabela-servopa/${table.id}`} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm">
                            <Printer className="h-4 w-4" />PDF
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {cartOpen && quotas.length > 0 && (
        <QuotasCart
          quotas={quotas}
          onCotasChange={setCotas}
          onRemove={toggleQuota}
          onClose={() => setCartOpen(false)}
          onSave={onSaveQuotas}
        />
      )}
    </>
  );
}

/**
 * As cotas já aderidas, fora do fluxo da página: fica visível enquanto você
 * navega entre grupos, que é justamente quando importa saber o que já entrou.
 */
function QuotasCart({
  quotas,
  onCotasChange,
  onRemove,
  onClose,
  onSave,
}: {
  quotas: AdheredQuota[];
  onCotasChange: (tableId: string, category: string, cotas: number) => void;
  onRemove: (quota: AdheredQuota) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const totals = totalizarQuotas(quotas);

  return (
    <aside className="surface-glass-panel fixed bottom-4 right-4 z-[60] w-[min(26rem,calc(100vw-2rem))] rounded-xl p-4 shadow-2xl ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Cotas deste negócio</h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Vão formar a tabela do documento.</p>
        </div>
        <button type="button" onClick={onClose} className="icon-btn h-7 w-7 shrink-0" aria-label="Fechar">
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      <ul className="scrollbar-thin mt-3 max-h-64 space-y-2 overflow-auto">
        {quotas.map((q) => (
          <li key={`${q.tableId}-${q.category}`} className="rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-800">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  Grupo {q.groupNumber} · {q.category}
                </p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {q.termMonths} meses · {formatPercent(calcularTaxaTotal(q.admEffective, q.reserveFundPercent), { trim: true })} ·{" "}
                  {formatBRL(q.creditValue)}
                </p>
                <p className="text-[11px] text-neutral-400">
                  ADM {formatPercent(q.admEffective, { trim: true })} + fundo{" "}
                  {q.reserveFundPercent ? formatPercent(q.reserveFundPercent, { trim: true }) : "—"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(q)}
                className="icon-btn h-7 w-7 shrink-0 text-neutral-400 hover:text-red-600"
                aria-label={`Remover grupo ${q.groupNumber} ${q.category}`}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                Cotas
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={q.cotas}
                  onChange={(e) => onCotasChange(q.tableId, q.category, Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
                  className="field-input h-8 w-16 px-2 text-center tabular-nums"
                  aria-label={`Quantidade de cotas do grupo ${q.groupNumber} ${q.category}`}
                />
              </label>
              <div className="text-right">
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Soma {formatBRL(calcularSomaPorGrupo(q.cotas, q.creditValue))}
                </p>
                <p className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                  {formatBRL(calcularParcelaInicial(q.cotas, q.installment))}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-neutral-200 pt-3 text-center dark:border-neutral-800">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Cotas</dt>
          <dd className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{totals.cotas}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Crédito</dt>
          <dd className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{formatBRL(totals.credito)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Parcelas</dt>
          <dd className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{formatBRL(totals.parcela)}</dd>
        </div>
      </dl>

      {/* Form próprio: o "salvar" das cotas não é o submit da proposta. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <button type="submit" className="btn-primary mt-3 w-full">
          <Save className="h-4 w-4" strokeWidth={2} />
          Salvar cotas e montar a tabela
        </button>
      </form>
    </aside>
  );
}

/** O mesmo conteúdo de /tabelas/[id], dentro do modal. */
function TableDetail({
  id,
  quotas,
  onToggle,
}: {
  id: string;
  quotas: AdheredQuota[];
  onToggle: (quota: AdheredQuota) => void;
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

  return (
    <div className="space-y-3 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {SEGMENT_LABEL[table.segment]} · {table.termMonths} meses · Taxa de ADM {formatPercent(table.admEffective, { trim: true })}
        </p>
        <Link href={`/tabela-servopa/${table.id}`} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm">
          <Printer className="h-4 w-4" strokeWidth={2} />
          Imprimir tabela
        </Link>
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-neutral-200 p-4 sm:grid-cols-5 dark:border-neutral-800">
        <DetailInfo label="Taxa de ADM">
          {formatPercent(table.admEffective, { trim: true })}
          {adjusted && (
            <span className="ml-1.5 text-xs font-normal text-neutral-500">
              (Servopa: {formatPercent(table.admOriginal, { trim: true })})
            </span>
          )}
        </DetailInfo>
        <DetailInfo label="Fundo de reserva">
          {table.reserveFundPercent ? formatPercent(table.reserveFundPercent, { trim: true }) : "—"}
        </DetailInfo>
        <DetailInfo label="Próxima assembleia">
          {table.nextAssemblyAt ? formatDateBR(new Date(table.nextAssemblyAt)) : "—"}
          {table.nextAssemblyNumber && <span className="ml-1.5 text-xs font-normal text-neutral-500">({table.nextAssemblyNumber}ª)</span>}
        </DetailInfo>
        <DetailInfo label="Vencimento">{table.dueDay ? `Dia ${table.dueDay}` : "—"}</DetailInfo>
        <DetailInfo label="Vagas disponíveis">{table.vacancies === null ? "Não informado" : table.vacancies}</DetailInfo>
      </dl>

      <div className="scrollbar-thin max-h-[42vh] overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="sticky top-0 z-10 bg-white dark:bg-neutral-900">
            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
              <th className="px-3 py-2.5 font-medium">Cat.</th>
              <th className="px-3 py-2.5 text-right font-medium">Valor do bem</th>
              <th className="px-3 py-2.5 text-right font-medium">Contribuição mensal</th>
              <th className="px-3 py-2.5 text-right font-medium">Parcela</th>
              <th className="px-3 py-2.5 text-right font-medium">Seguro</th>
              <th className="px-3 py-2.5 text-right font-medium">Total</th>
              <th className="px-3 py-2.5 text-right font-medium">Aderir ao negócio</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/70">
            {table.rows.map((r) => {
              const adhered = quotas.some((q) => q.tableId === table.id && q.category === r.category);
              return (
                <tr key={r.category} className={adhered ? "bg-brand-light/30 dark:bg-brand-light/10" : undefined}>
                  <td className="px-3 py-2.5 font-medium text-neutral-900 dark:text-neutral-100">{r.category}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatBRL(r.creditValue)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatPercent(r.monthlyPercent)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatBRL(r.installment)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatBRL(r.insurance)}</td>
                  <td className="px-3 py-2.5 text-right font-medium tabular-nums">{formatBRL(r.total)}</td>
                  <td className="px-3 py-2.5 text-right">
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
                      {adhered ? "Aderida" : "Aderir"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {table.contemplationText && (
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Regras do grupo (texto da Servopa)</h3>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-neutral-600 dark:text-neutral-300">{table.contemplationText}</pre>
        </div>
      )}
    </div>
  );
}

function DetailInfo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">{children}</dd>
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
