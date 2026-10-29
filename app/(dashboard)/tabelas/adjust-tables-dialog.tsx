"use client";

import { useMemo, useState } from "react";
import { Loader2, Minus, Percent, Plus, RotateCcw } from "lucide-react";
import { Modal } from "@/components/modal";
import { requestJson } from "@/lib/client-request";
import { fromUnits, toUnits } from "@/lib/servopa-tables/adjust";
import { formatPercent } from "@/lib/servopa-tables/format";
import type { ServopaTableListView } from "@/lib/servopa-tables/queries";

type Operation = "DISCOUNT" | "INCREASE" | "RESET";
type Scope = "selected" | "filtered";

type AdjustmentResponse = {
  updated: number;
  adjustmentPoints: string;
  adjustedAt: string;
};

function parsePoints(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,3}(?:\.\d{1,4})?$/.test(normalized)) return null;
  const units = toUnits(normalized, 4);
  return units > 0 && units <= 1_000_000 ? units : null;
}

function RatePreview({ tables, operation, pointsUnits }: {
  tables: ServopaTableListView[];
  operation: Operation;
  pointsUnits: number | null;
}) {
  if (tables.length === 0 || (operation !== "RESET" && pointsUnits === null)) return null;
  const signed = operation === "RESET" ? 0 : operation === "DISCOUNT" ? -pointsUnits! : pointsUnits!;
  const rates = tables.map((table) => toUnits(table.admOriginal, 4) + signed);
  if (rates.some((rate) => rate < 0)) return null;
  const min = formatPercent(fromUnits(Math.min(...rates), 4), { trim: true });
  const max = formatPercent(fromUnits(Math.max(...rates), 4), { trim: true });
  return (
    <div className="flex items-center justify-between gap-4 border-y border-neutral-200 py-3 dark:border-neutral-800">
      <span className="text-sm text-neutral-500">Taxa final</span>
      <span className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
        {min === max ? min : `${min} a ${max}`}
      </span>
    </div>
  );
}

const OPERATIONS: Array<{ value: Operation; label: string; icon: typeof Minus }> = [
  { value: "DISCOUNT", label: "Desconto", icon: Minus },
  { value: "INCREASE", label: "Acréscimo", icon: Plus },
  { value: "RESET", label: "Restaurar", icon: RotateCcw },
];

export function AdjustTablesDialog({
  selectedTables,
  filteredTables,
  onClose,
  onApplied,
}: {
  selectedTables: ServopaTableListView[];
  filteredTables: ServopaTableListView[];
  onClose: () => void;
  onApplied: (result: AdjustmentResponse) => void;
}) {
  const [scope, setScope] = useState<Scope>(selectedTables.length > 0 ? "selected" : "filtered");
  const [operation, setOperation] = useState<Operation>("DISCOUNT");
  const [points, setPoints] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targets = scope === "selected" ? selectedTables : filteredTables;
  const pointsUnits = operation === "RESET" ? 0 : parsePoints(points);

  const validation = useMemo(() => {
    if (targets.length === 0) return "Nenhuma tabela escolhida.";
    if (operation !== "RESET" && pointsUnits === null) return points ? "Informe um valor entre 0 e 100." : null;
    if (operation !== "RESET" && targets.some((table) => table.reserveFundPercent === null)) {
      return "Há tabelas sem fundo de reserva informado.";
    }
    if (operation === "DISCOUNT" && pointsUnits !== null && targets.some((table) => toUnits(table.admOriginal, 4) - pointsUnits < 0)) {
      return "O desconto deixaria uma taxa negativa.";
    }
    return null;
  }, [operation, points, pointsUnits, targets]);

  const groupCount = new Set(targets.map((table) => table.groupNumber)).size;
  const canSubmit = !saving && targets.length > 0 && (operation === "RESET" || pointsUnits !== null) && !validation;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    const result = await requestJson<AdjustmentResponse>("/api/servopa-tables/adjust", {
      method: "POST",
      json: {
        tableIds: targets.map((table) => table.id),
        operation,
        ...(operation === "RESET" ? {} : { points: fromUnits(pointsUnits!, 4) }),
      },
    }, { silent: true });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onApplied(result.data);
  }

  return (
    <Modal onClose={saving ? () => {} : onClose} maxWidth="max-w-lg">
      <div className="space-y-5">
        <header className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
            <Percent className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Ajustar taxa de ADM</h2>
            <p className="text-sm text-neutral-500">O novo ajuste substitui o anterior.</p>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-2 rounded-md bg-neutral-100 p-1 dark:bg-neutral-900">
          <button
            type="button"
            disabled={selectedTables.length === 0}
            onClick={() => setScope("selected")}
            className={`rounded px-3 py-2 text-sm font-medium transition-colors ${scope === "selected" ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100" : "text-neutral-500 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:text-neutral-200"}`}
          >
            Selecionadas ({selectedTables.length})
          </button>
          <button
            type="button"
            onClick={() => setScope("filtered")}
            className={`rounded px-3 py-2 text-sm font-medium transition-colors ${scope === "filtered" ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100" : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"}`}
          >
            Filtradas ({filteredTables.length})
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {OPERATIONS.map(({ value, label, icon: Icon }) => {
            const active = operation === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => { setOperation(value); setError(null); }}
                className={`flex h-10 items-center justify-center gap-2 rounded-md border px-2 text-sm font-medium transition-colors ${active ? "border-brand bg-brand/10 text-brand" : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"}`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>

        {operation !== "RESET" && (
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Pontos percentuais</span>
            <div className="relative">
              <input
                autoFocus
                inputMode="decimal"
                value={points}
                onChange={(event) => { setPoints(event.target.value.replace(/[^\d.,]/g, "")); setError(null); }}
                placeholder="Ex.: 1,5"
                className="field-input pr-12 tabular-nums"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">p.p.</span>
            </div>
          </label>
        )}

        <div>
          <RatePreview tables={targets} operation={operation} pointsUnits={pointsUnits} />
          <p className="mt-2 text-xs text-neutral-500">
            {targets.length} {targets.length === 1 ? "tabela" : "tabelas"} em {groupCount} {groupCount === 1 ? "grupo" : "grupos"}
          </p>
        </div>

        {(error || validation) && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error ?? validation}</p>}

        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">Cancelar</button>
          <button type="button" onClick={submit} disabled={!canSubmit} className="btn-primary min-w-28">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : operation === "RESET" ? "Restaurar" : "Aplicar ajuste"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
