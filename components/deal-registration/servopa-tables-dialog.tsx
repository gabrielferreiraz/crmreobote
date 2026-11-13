"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, Printer, Search, X } from "lucide-react";
import { Modal } from "@/components/modal";
import type { ServopaTableListView } from "@/lib/servopa-tables/queries";
import { toUnits } from "@/lib/servopa-tables/adjust";
import { formatBRL, formatDateBR, formatPercent, SEGMENT_LABEL } from "@/lib/servopa-tables/format";

/** Como a lista chega pelo JSON: as datas viram texto na serialização. */
type TableRow = Omit<ServopaTableListView, "nextAssemblyAt"> & { nextAssemblyAt: string | null };

type Filters = { grupo: string; segmento: string; prazo: string; taxa: string };
const EMPTY_FILTERS: Filters = { grupo: "", segmento: "", prazo: "", taxa: "" };

/**
 * MESMA rota que /tabelas e a consulta da proposta usam
 * (components/proposals/tables-lookup-dialog.tsx). Fica aqui, fora do
 * componente, para deixar claro que esta tela só LÊ: nada daqui altera tabela,
 * nem ajuste de taxa.
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
 * As tabelas da Servopa abertas de dentro do cadastro do Ganho (botão "Acessar
 * tabelas", que só existe quando a administradora é a Servopa).
 *
 * Por enquanto é só consulta: mostra os grupos e deixa gerar o PDF, sem levar
 * nada para os campos da cota. É por isso que não reaproveita o painel da
 * proposta — aquele é inseparável do carrinho de cotas e do "Usar na
 * proposta", que aqui não existem. O que os dois compartilham é o que importa:
 * a rota, os tipos e a formatação.
 */
export function ServopaTablesDialog({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<{ tables: TableRow[]; lastSyncAt: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

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
    // Com MOTIVO e só se ainda estiver em voo (mesmo cuidado da proposta): um
    // `abort()` pelado vira "signal is aborted without reason" no painel de
    // erro do dev, porque o StrictMode monta, desmonta e monta de novo.
    return () => {
      if (!done) controller.abort(new DOMException("Consulta de tabelas cancelada: a janela fechou.", "AbortError"));
    };
  }, [attempt]);

  const tables = data?.tables;
  const terms = useMemo(() => [...new Set(tables?.map((t) => t.termMonths) ?? [])].sort((a, b) => a - b), [tables]);
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

  return (
    <Modal onClose={onClose} maxWidth="max-w-5xl">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Tabelas da Servopa</h2>
            <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
              Grupo, prazo, taxa e crédito como a Servopa publicou.
              {data?.lastSyncAt && ` Atualizadas em ${formatDateBR(new Date(data.lastSyncAt))}.`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="icon-btn h-8 w-8 shrink-0" aria-label="Fechar">
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2.5 py-20 text-sm text-neutral-500 dark:text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
            Carregando as tabelas…
          </div>
        )}

        {error && (
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

        {tables && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <div className="relative min-w-0 flex-1 basis-full sm:basis-56">
                <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
                <input
                  inputMode="numeric"
                  value={filters.grupo}
                  onChange={(e) => setFilters((f) => ({ ...f, grupo: e.target.value.replace(/\D/g, "") }))}
                  placeholder="Buscar pelo número do grupo"
                  aria-label="Buscar pelo número do grupo"
                  className="field-input h-10 pr-9 pl-10"
                />
                {filters.grupo && (
                  <button
                    type="button"
                    onClick={() => setFilters((f) => ({ ...f, grupo: "" }))}
                    className="absolute top-1/2 right-2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
                    aria-label="Limpar busca"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
              <div role="group" aria-label="Segmento" className="flex items-center gap-4">
                {[
                  { value: "", label: "Todos" },
                  { value: "REAL_ESTATE", label: "Imóveis" },
                  { value: "MOVABLE", label: "Móveis" },
                ].map((item) => {
                  const active = filters.segmento === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setFilters((f) => ({ ...f, segmento: item.value }))}
                      aria-pressed={active}
                      className={`border-b-2 py-1.5 text-sm font-medium transition-colors ${
                        active
                          ? "border-brand text-neutral-900 dark:text-neutral-100"
                          : "border-transparent text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
              <select
                aria-label="Prazo"
                value={filters.prazo}
                onChange={(e) => setFilters((f) => ({ ...f, prazo: e.target.value }))}
                className="field-input field-select h-10 w-full sm:w-36"
              >
                <option value="">Todos os prazos</option>
                {terms.map((months) => (
                  <option key={months} value={months}>
                    {months} meses
                  </option>
                ))}
              </select>
              <select
                aria-label="Taxa de administração"
                value={filters.taxa}
                onChange={(e) => setFilters((f) => ({ ...f, taxa: e.target.value }))}
                className="field-input field-select h-10 w-full sm:w-44"
              >
                <option value="">Todas as taxas de ADM</option>
                {rates.map((rate) => (
                  <option key={rate} value={rate}>
                    ADM {formatPercent(rate, { trim: true })}
                  </option>
                ))}
              </select>
              {hasFilters && (
                <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className="btn-ghost h-10" title="Limpar filtros">
                  <X className="h-4 w-4" aria-hidden="true" />
                  Limpar filtros
                </button>
              )}
            </div>

            <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
              {visible.length === tables.length ? `${tables.length} tabelas` : `${visible.length} de ${tables.length} tabelas`}
            </p>

            {visible.length === 0 ? (
              <div className="border-y border-neutral-200 py-12 text-center text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                Nenhuma tabela com esses filtros.
              </div>
            ) : (
              <div className="scrollbar-thin max-h-[60vh] overflow-auto border-y border-neutral-200 dark:border-neutral-800">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="sticky top-0 z-10 bg-white dark:bg-neutral-900">
                    <tr className="border-b border-neutral-200 text-left text-[11px] tracking-[0.14em] text-neutral-500 uppercase dark:border-neutral-800 dark:text-neutral-400">
                      <th className="px-3 py-3 font-medium">Grupo</th>
                      <th className="px-3 py-3 font-medium">Segmento</th>
                      <th className="px-3 py-3 font-medium">Prazo</th>
                      <th className="px-3 py-3 font-medium">ADM</th>
                      <th className="px-3 py-3 font-medium">Crédito</th>
                      <th className="px-3 py-3 font-medium">Parcela</th>
                      <th className="px-3 py-3 font-medium">Vagas</th>
                      <th className="px-3 py-3 font-medium">Assembleia</th>
                      <th className="px-3 py-3">
                        <span className="sr-only">PDF</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/70">
                    {visible.map((table) => {
                      const low = table.vacancies !== null && table.vacancies <= 20;
                      return (
                        <tr key={table.id} className="transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                          <td className="px-3 py-3 font-semibold whitespace-nowrap text-neutral-900 dark:text-neutral-100">
                            Grupo {table.groupNumber}
                          </td>
                          <td className="px-3 py-3">
                            <span className="inline-flex items-center gap-2 whitespace-nowrap text-neutral-700 dark:text-neutral-200">
                              <span
                                className={`h-2 w-2 rounded-full ${table.segment === "REAL_ESTATE" ? "bg-emerald-500" : "bg-sky-500"}`}
                                aria-hidden="true"
                              />
                              {SEGMENT_LABEL[table.segment]}
                            </span>
                          </td>
                          <td className="px-3 py-3 tabular-nums whitespace-nowrap text-neutral-600 dark:text-neutral-300">
                            {table.termMonths} meses
                          </td>
                          <td className="px-3 py-3 font-medium tabular-nums text-neutral-900 dark:text-neutral-100">
                            {formatPercent(table.admEffective, { trim: true })}
                          </td>
                          <td className="px-3 py-3">
                            <MoneyRange range={table.creditRange} />
                          </td>
                          <td className="px-3 py-3">
                            <MoneyRange range={table.installmentRange} />
                          </td>
                          <td
                            className={`px-3 py-3 tabular-nums whitespace-nowrap ${
                              low ? "font-semibold text-amber-600 dark:text-amber-400" : "text-neutral-700 dark:text-neutral-200"
                            }`}
                          >
                            {table.vacancies === null ? "—" : `${table.vacancies} ${table.vacancies === 1 ? "vaga" : "vagas"}`}
                          </td>
                          <td className="px-3 py-3 tabular-nums whitespace-nowrap text-neutral-600 dark:text-neutral-300">
                            {table.nextAssemblyAt ? formatDateBR(new Date(table.nextAssemblyAt)) : "—"}
                          </td>
                          <td className="px-3 py-3 text-right">
                            {/* O PDF é uma folha pronta para impressão; aí sim, aba nova. */}
                            <Link
                              href={`/tabela-servopa/${table.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn-secondary btn-sm"
                              title="Gerar PDF desta tabela"
                            >
                              <Printer className="h-4 w-4" />
                              PDF
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function MoneyRange({ range }: { range: { min: string; max: string } }) {
  if (range.min === range.max) return <span className="tabular-nums whitespace-nowrap">{formatBRL(range.min)}</span>;
  return (
    <div className="leading-5 tabular-nums">
      <div className="font-medium whitespace-nowrap text-neutral-900 dark:text-neutral-100">{formatBRL(range.min)}</div>
      <div className="text-xs whitespace-nowrap text-neutral-400">até {formatBRL(range.max)}</div>
    </div>
  );
}
