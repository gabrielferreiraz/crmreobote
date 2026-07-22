"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Target, Pencil, Check, X, Loader2 } from "lucide-react";
import { CurrencyInput } from "@/components/currency-input";
import { formatCurrency } from "@/lib/format";

type PaceStatus = "ahead" | "onTrack" | "behind";

const PACE_LABEL: Record<PaceStatus, string> = {
  ahead: "Adiantado",
  onTrack: "No ritmo",
  behind: "Atrás do ritmo",
};
const PACE_BADGE: Record<PaceStatus, string> = {
  ahead: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  onTrack: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  behind: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
};
const PACE_DOT: Record<PaceStatus, string> = {
  ahead: "bg-emerald-500",
  onTrack: "bg-neutral-400",
  behind: "bg-amber-500",
};

/**
 * Meta mensal do time — sempre o mês corrente, sempre a organização inteira
 * (não respeita os filtros de período/equipe do resto do relatório, ver
 * comentário em relatorios/page.tsx). Qualquer papel vê o card; só Dono
 * enxerga o lápis de editar (ver requireRole(["OWNER"]) na API).
 */
export function GoalCard({
  monthLabel,
  goalValue,
  achievedValue,
  isOwner,
  daysElapsed,
  daysInMonth,
}: {
  monthLabel: string;
  goalValue: number | null;
  achievedValue: number;
  isOwner: boolean;
  daysElapsed: number;
  daysInMonth: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(goalValue !== null ? String(goalValue) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const value = draft ? Number(draft) : NaN;
    if (!Number.isFinite(value) || value <= 0) {
      setError("Informe um valor de meta maior que zero");
      return;
    }
    setSaving(true);
    setError(null);

    const res = await fetch("/api/goals/current", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao salvar meta");
      return;
    }

    setEditing(false);
    router.refresh();
  }

  const hasGoal = goalValue !== null && goalValue > 0;
  const pct = hasGoal ? Math.round((achievedValue / goalValue!) * 100) : 0;
  const remaining = hasGoal ? Math.max(0, goalValue! - achievedValue) : 0;
  const exceeded = hasGoal && achievedValue >= goalValue!;
  const exceededBy = exceeded ? achievedValue - goalValue! : 0;
  const barPct = hasGoal ? Math.min(100, pct) : 0;

  // Ritmo: % do mês já passado vs % da meta já batida — dá pra ver se o
  // ritmo atual chega lá antes do fim do mês, em vez de só descobrir no
  // dia 30. Projeção é uma extrapolação linear simples (valor/dia × dias do
  // mês) — fica maluca nos primeiros dias do mês (normal pra esse tipo de
  // métrica, todo painel de meta com ritmo tem essa limitação).
  const pacePct = Math.min(100, Math.round((daysElapsed / daysInMonth) * 100));
  const projectedValue = hasGoal && daysElapsed > 0 ? (achievedValue / daysElapsed) * daysInMonth : 0;
  const paceDeltaPoints = pct - pacePct;
  const paceStatus: PaceStatus = paceDeltaPoints >= 5 ? "ahead" : paceDeltaPoints <= -5 ? "behind" : "onTrack";

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-neutral-100 dark:bg-neutral-800">
            <Target className="h-4 w-4 text-neutral-500 dark:text-neutral-400" strokeWidth={2} />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Meta de {monthLabel}</p>
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              Vale pro time inteiro — não muda com os filtros acima
            </p>
          </div>
        </div>

        {isOwner && !editing && (
          <button
            type="button"
            onClick={() => {
              setDraft(goalValue !== null ? String(goalValue) : "");
              setError(null);
              setEditing(true);
            }}
            className="icon-btn shrink-0"
            aria-label={hasGoal ? "Editar meta" : "Definir meta"}
            title={hasGoal ? "Editar meta" : "Definir meta"}
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="w-40 space-y-1">
            <label className="field-label">Meta do mês (R$)</label>
            <CurrencyInput value={draft} onChange={setDraft} />
          </div>
          <button type="button" onClick={() => setEditing(false)} disabled={saving} className="btn-ghost btn-sm">
            <X className="h-3.5 w-3.5" strokeWidth={2} />
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className="btn-primary btn-sm">
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
            ) : (
              <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
            )}
            Salvar
          </button>
          {error && <p className="w-full text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
      ) : !hasGoal ? (
        <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
          {isOwner
            ? "Nenhuma meta definida ainda — clique no lápis pra definir."
            : "O dono ainda não definiu uma meta pra este mês."}
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <span className="text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                {formatCurrency(achievedValue)}
              </span>
              <span className="ml-2 text-xs font-medium text-neutral-400 dark:text-neutral-500">
                de {formatCurrency(goalValue)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {!exceeded && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${PACE_BADGE[paceStatus]}`}
                  title={`Meta batida: ${pct}% · Mês decorrido: ${pacePct}%`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${PACE_DOT[paceStatus]}`} />
                  {PACE_LABEL[paceStatus]}
                </span>
              )}
              <span
                className={`text-xl font-bold tabular-nums ${
                  exceeded ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-900 dark:text-neutral-100"
                }`}
              >
                {pct}%
              </span>
            </div>
          </div>

          <div className="relative">
            <div className="h-3 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div
                className={`h-full rounded-full transition-all ${exceeded ? "bg-emerald-500" : "bg-neutral-900 dark:bg-white"}`}
                style={{ width: `${barPct}%` }}
              />
            </div>
            {!exceeded && pacePct > 0 && pacePct < 100 && (
              <div
                className="absolute -top-0.5 -bottom-0.5 w-0.5 -translate-x-1/2 rounded-full bg-amber-500"
                style={{ left: `${pacePct}%` }}
                title={`Ritmo esperado: dia ${daysElapsed} de ${daysInMonth} do mês (${pacePct}% do período)`}
              />
            )}
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 pt-1">
            <div className="rounded-md border border-neutral-100 dark:border-neutral-800/80 bg-neutral-50/50 dark:bg-neutral-900/40 p-2.5">
              <p className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
                {exceeded ? "Excedente" : "Falta pra meta"}
              </p>
              <p className="mt-0.5 text-sm font-semibold text-neutral-800 dark:text-neutral-200 tabular-nums">
                {exceeded ? formatCurrency(exceededBy) : formatCurrency(remaining)}
              </p>
            </div>
            {!exceeded && (
              <div className="rounded-md border border-neutral-100 dark:border-neutral-800/80 bg-neutral-50/50 dark:bg-neutral-900/40 p-2.5">
                <p className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
                  Projeção no ritmo atual
                </p>
                <p className="mt-0.5 text-sm font-semibold text-neutral-800 dark:text-neutral-200 tabular-nums">
                  {formatCurrency(projectedValue)}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
