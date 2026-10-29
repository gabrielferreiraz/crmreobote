"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Clock3, History, RotateCcw } from "lucide-react";
import { SidePanel } from "@/components/side-panel";
import { LoadingDots } from "@/components/loading-dots";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { columnLabel, columnLetter, displayCell, type ClientColumn } from "@/lib/sheets/format";
import type { CellValue } from "@/lib/sheets/column-types";

type Item = {
  id: string;
  rowId: string | null;
  userName: string | null;
  source: string;
  action: string;
  changes: unknown;
  createdAt: string;
};

type VersionPlan = {
  activityId: string;
  createdAt: string;
  newerCount: number;
  counts: Record<string, number>;
  canRestore: boolean;
  problems: { activityId: string; action: string; problem: string }[];
};

const ACTION_LABELS: Record<string, string> = {
  SHEET_CREATED: "criou a planilha",
  SHEET_UPDATED: "alterou a planilha",
  SHEET_ARCHIVED: "arquivou a planilha",
  SHEET_RESTORED: "restaurou a planilha",
  COLUMN_CREATED: "criou uma coluna",
  COLUMN_UPDATED: "alterou uma coluna",
  COLUMN_ARCHIVED: "arquivou uma coluna",
  COLUMN_RESTORED: "restaurou uma coluna",
  COLUMN_CLEARED: "limpou colunas",
  ROW_CREATED: "criou uma linha",
  ROW_UPDATED: "alterou células",
  ROW_FORMATTED: "alterou a formatação",
  ROW_FORMULA: "alterou fórmulas",
  ROW_DELETED: "excluiu uma linha",
  ROW_RESTORED: "restaurou uma linha",
  VERSION_RESTORED: "restaurou uma versão anterior",
};

const COUNT_LABELS: Record<string, string> = {
  ROW_CREATED: "linhas criadas",
  ROW_UPDATED: "edições de células",
  ROW_FORMATTED: "alterações de formato",
  ROW_FORMULA: "alterações de fórmula",
  ROW_DELETED: "linhas excluídas",
  ROW_RESTORED: "linhas restauradas",
  COLUMN_CREATED: "colunas criadas",
  COLUMN_UPDATED: "alterações de coluna",
  COLUMN_ARCHIVED: "colunas arquivadas",
  COLUMN_RESTORED: "colunas restauradas",
  SHEET_UPDATED: "alterações da planilha",
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function pairEntries(value: unknown): [string, [unknown, unknown]][] {
  const obj = record(value);
  if (!obj) return [];
  return Object.entries(obj).flatMap(([key, value]) => (Array.isArray(value) && value.length === 2 ? [[key, [value[0], value[1]]]] : []));
}

function formatSummary(value: unknown) {
  const fmt = record(value);
  if (!fmt) return "sem formatação";
  const labels = [
    fmt.b ? "negrito" : null,
    fmt.i ? "itálico" : null,
    fmt.u ? "sublinhado" : null,
    fmt.s ? "tachado" : null,
    typeof fmt.fill === "string" ? `fundo ${fmt.fill}` : null,
    typeof fmt.color === "string" ? `texto ${fmt.color}` : null,
    typeof fmt.align === "string" ? `alinhado ${fmt.align}` : null,
    Object.keys(fmt).some((key) => key.startsWith("border")) ? "bordas" : null,
  ].filter(Boolean);
  return labels.length ? labels.join(", ") : "formatação padrão";
}

export function HistoryPanel({
  sheetId,
  rowId,
  columns,
  refs,
  formulaToText,
  rowNumber,
  onRestored,
  onClose,
}: {
  sheetId: string;
  rowId?: string;
  columns: ClientColumn[];
  refs: Record<string, string>;
  formulaToText?: (internal: string, rowId: string) => string | undefined;
  rowNumber?: (rowId: string) => number | undefined;
  onRestored: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [plan, setPlan] = useState<VersionPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const qs = new URLSearchParams({ limit: "500", ...(rowId ? { rowId } : {}) });
    fetch(`/api/sheets/${sheetId}/history?${qs}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Não foi possível carregar o histórico");
        setItems(data.items);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => controller.abort();
  }, [sheetId, rowId]);

  const colById = useMemo(() => new Map(columns.map((column, index) => [column.id, { column, index }])), [columns]);
  const show = (colId: string, value: unknown, itemRowId: string | null) => {
    const col = colById.get(colId)?.column;
    if (value === null || value === undefined || value === "") return <span className="italic text-neutral-400">vazio</span>;
    if (typeof value === "string" && value.startsWith("=") && value.includes("⟦")) {
      return <span className="font-mono">{(itemRowId && formulaToText?.(value, itemRowId)) ?? "fórmula (linha fora da tela)"}</span>;
    }
    return col ? displayCell(col, value as CellValue, refs) : String(value);
  };

  async function inspectVersion(item: Item) {
    const next = expanded === item.id ? null : item.id;
    setExpanded(next);
    setPlan(null);
    setRestoreError(null);
    if (!next || rowId) return;
    setPlanLoading(true);
    try {
      const res = await fetch(`/api/sheets/${sheetId}/history?version=${encodeURIComponent(item.id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Não foi possível montar esta versão");
      setPlan(data.plan);
    } catch (err) {
      setRestoreError((err as Error).message);
    } finally {
      setPlanLoading(false);
    }
  }

  async function restore() {
    if (!plan) return;
    setRestoreError(null);
    const res = await fetch(`/api/sheets/${sheetId}/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activityId: plan.activityId }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setRestoreError(data?.error ?? "Não foi possível restaurar esta versão");
      return;
    }
    setConfirming(false);
    await onRestored();
    onClose();
  }

  return (
    <>
      <SidePanel onClose={onClose} title={rowId ? "Histórico da linha" : "Histórico de versões"} maxWidth="max-w-2xl">
        {!rowId && (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-sm text-emerald-900 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-100">
            <p className="font-medium">Escolha um ponto da linha do tempo para visualizar ou restaurar.</p>
            <p className="mt-1 text-xs opacity-75">A restauração cria novos registros no histórico; nada é apagado silenciosamente.</p>
          </div>
        )}
        {error ? (
          <p className="p-4 text-sm text-red-600">{error}</p>
        ) : !items ? (
          <div className="flex justify-center p-8"><LoadingDots /></div>
        ) : items.length === 0 ? (
          <EmptyState icon={History} title="Nenhuma alteração registrada" />
        ) : (
          <ol className="relative ml-2 border-l border-neutral-200 pl-5 dark:border-neutral-800">
            {items.map((item) => {
              const who = item.source.startsWith("api:") ? "Integração (API)" : (item.userName ?? "Alguém");
              const cellChanges = ["ROW_UPDATED", "ROW_CREATED", "ROW_FORMULA", "ROW_FORMATTED"].includes(item.action) ? pairEntries(item.changes) : [];
              const structure = record(item.changes);
              const beforeStructure = record(structure?.before);
              const afterStructure = record(structure?.after);
              const isOpen = expanded === item.id;
              const rn = item.rowId ? rowNumber?.(item.rowId) : undefined;
              return (
                <li key={item.id} className="relative pb-4">
                  <span className={`absolute -left-[27px] top-3 h-3 w-3 rounded-full border-2 border-white dark:border-neutral-950 ${item.action === "VERSION_RESTORED" ? "bg-amber-500" : "bg-emerald-600"}`} />
                  <article className={`overflow-hidden rounded-xl border bg-white transition-shadow dark:bg-neutral-950 ${isOpen ? "border-emerald-400 shadow-md shadow-emerald-950/5" : "border-neutral-200 dark:border-neutral-800"}`}>
                    <button type="button" onClick={() => inspectVersion(item)} className="flex w-full items-start gap-3 p-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900/70">
                      <span className="mt-0.5 text-neutral-400">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-neutral-800 dark:text-neutral-200"><strong>{who}</strong> {ACTION_LABELS[item.action] ?? item.action}</span>
                        <span className="mt-1 flex items-center gap-1 text-xs text-neutral-400"><Clock3 className="h-3 w-3" />{new Date(item.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" })}</span>
                      </span>
                    </button>

                    {cellChanges.length > 0 && (
                      <div className="border-t border-neutral-100 px-3 py-2 dark:border-neutral-800">
                        <div className="grid grid-cols-[minmax(90px,0.75fr)_minmax(0,1fr)_20px_minmax(0,1fr)] gap-2 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
                          <span>Célula</span><span>Antes</span><span /><span>Depois</span>
                        </div>
                        <ul className="mt-1.5 space-y-1.5">
                          {cellChanges.slice(0, 25).map(([colId, [before, after]]) => {
                            const found = colById.get(colId);
                            const address = found && rn ? `${columnLetter(found.index)}${rn}` : rn ? `?${rn}` : "—";
                            return (
                              <li key={colId} className="grid grid-cols-[minmax(90px,0.75fr)_minmax(0,1fr)_20px_minmax(0,1fr)] items-stretch gap-2 text-xs">
                                <span className="min-w-0 py-1"><strong className="block font-mono text-emerald-700 dark:text-emerald-400">{address}</strong><span className="block truncate text-neutral-500">{found ? columnLabel(found.column, found.index) : "Coluna arquivada"}</span></span>
                                <span className="min-w-0 break-words rounded-md bg-red-50 px-2 py-1.5 text-red-800 dark:bg-red-500/10 dark:text-red-300">{item.action === "ROW_FORMATTED" ? formatSummary(before) : show(colId, before, item.rowId)}</span>
                                <span className="self-center text-center text-neutral-300">→</span>
                                <span className="min-w-0 break-words rounded-md bg-emerald-50 px-2 py-1.5 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">{item.action === "ROW_FORMATTED" ? formatSummary(after) : show(colId, after, item.rowId)}</span>
                              </li>
                            );
                          })}
                        </ul>
                        {cellChanges.length > 25 && <p className="mt-2 text-xs text-neutral-400">+ {cellChanges.length - 25} alteração(ões)</p>}
                      </div>
                    )}

                    {beforeStructure && afterStructure && (
                      <div className="grid grid-cols-[1fr_20px_1fr] gap-2 border-t border-neutral-100 p-3 text-xs dark:border-neutral-800">
                        <pre className="overflow-auto rounded-md bg-red-50 p-2 text-red-800 dark:bg-red-500/10 dark:text-red-300">{JSON.stringify(beforeStructure, null, 2)}</pre>
                        <span className="self-center text-center text-neutral-300">→</span>
                        <pre className="overflow-auto rounded-md bg-emerald-50 p-2 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">{JSON.stringify(afterStructure, null, 2)}</pre>
                      </div>
                    )}

                    {isOpen && !rowId && (
                      <div className="border-t border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/60">
                        {planLoading ? <div className="flex justify-center py-3"><LoadingDots /></div> : plan ? (
                          <div className="space-y-3">
                            <div>
                              <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Estado da planilha após esta alteração</p>
                              <p className="mt-0.5 text-xs text-neutral-500">{plan.newerCount === 0 ? "Esta já é a versão atual." : `Para voltar aqui, ${plan.newerCount} evento(s) posterior(es) serão revertidos.`}</p>
                            </div>
                            {Object.keys(plan.counts).length > 0 && (
                              <div className="flex flex-wrap gap-1.5">{Object.entries(plan.counts).map(([action, count]) => <span key={action} className="rounded-full border border-neutral-200 bg-white px-2 py-1 text-[11px] text-neutral-600 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">{count} {COUNT_LABELS[action] ?? ACTION_LABELS[action] ?? action}</span>)}</div>
                            )}
                            {plan.problems.length > 0 && (
                              <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>Esta versão só pode ser visualizada: {plan.problems[0].problem}.</span></div>
                            )}
                            {restoreError && <p className="text-xs font-medium text-red-600 dark:text-red-400">{restoreError}</p>}
                            <div className="flex justify-end"><button type="button" disabled={!plan.canRestore} onClick={() => setConfirming(true)} className="btn-primary btn-sm inline-flex items-center gap-1.5"><RotateCcw className="h-3.5 w-3.5" />Restaurar esta versão</button></div>
                          </div>
                        ) : restoreError ? <p className="text-xs text-red-600">{restoreError}</p> : null}
                      </div>
                    )}
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </SidePanel>
      {confirming && plan && (
        <ConfirmDialog
          title="Restaurar esta versão da planilha?"
          description={`Serão revertidos ${plan.newerCount} evento(s) posteriores. A restauração ficará registrada no histórico e a página será atualizada.`}
          error={restoreError}
          confirmLabel="Restaurar versão"
          danger={false}
          onClose={() => { setConfirming(false); setRestoreError(null); }}
          onConfirm={restore}
        />
      )}
    </>
  );
}
