"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Target, Pencil, Check, X, Loader2 } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/badge";
import { CurrencyInput } from "@/components/currency-input";
import { formatCurrency } from "@/lib/format";

type PaceStatus = "ahead" | "onTrack" | "behind";

const PACE_LABEL: Record<PaceStatus, string> = {
  ahead: "Adiantado",
  onTrack: "No ritmo",
  behind: "Atrás do ritmo",
};
const PACE_TONE: Record<PaceStatus, BadgeTone> = {
  ahead: "success",
  onTrack: "neutral",
  behind: "warning",
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
  sellerCount,
  suggestedValue,
  goalBasisChanged,
}: {
  monthLabel: string;
  goalValue: number | null;
  achievedValue: number;
  isOwner: boolean;
  daysElapsed: number;
  daysInMonth: number;
  /** Consultores (MEMBER) ativos agora — base da sugestão (ver lib/goals/suggestion.ts). */
  sellerCount: number;
  /** sellerCount × R$1,2M. */
  suggestedValue: number;
  /** true = já existe meta pro mês, mas o time mudou de tamanho desde que ela foi salva. */
  goalBasisChanged: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(goalValue !== null ? String(goalValue) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveGoal(value: number) {
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

  async function handleSave() {
    const value = draft ? Number(draft) : NaN;
    if (!Number.isFinite(value) || value <= 0) {
      setError("Informe um valor de meta maior que zero");
      return;
    }
    // Não mudou nada (reabriu e fechou, ou apagou e redigitou o mesmo
    // número) — pedido explícito: não faz sentido gravar de novo o que já
    // está salvo. Comparação em CENTAVOS arredondados, não ===: goalValue
    // vem do banco (Decimal virando number), draft vem de um campo de
    // moeda (centavos inteiros por baixo, ver CurrencyInput) — os dois
    // devem bater exato pro mesmo valor digitado, mas comparar em ponto
    // flutuante direto é sempre a aposta errada.
    const unchanged = goalValue !== null && Math.round(value * 100) === Math.round(goalValue * 100);
    if (unchanged) {
      cancelEditing();
      return;
    }
    await saveGoal(value);
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

  function startEditing() {
    if (!isOwner) return;
    setDraft(goalValue !== null ? String(goalValue) : "");
    setError(null);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setError(null);
  }

  function handleEditKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEditing();
    }
  }

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-neutral-100 dark:bg-neutral-800">
          <Target className="h-4 w-4 text-neutral-500 dark:text-neutral-400" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Meta de {monthLabel}</p>
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            Time inteiro<span className="hidden sm:inline"> — não muda com os filtros acima</span>
          </p>
        </div>
      </div>

      {/* O valor edita ONDE ele mora — pedido explícito do usuário: o botão
          "Editar" ficava no canto direito do card e o campo de edição
          abria do lado ESQUERDO, bem longe de onde o olho estava. Clicar no
          próprio número já entra em edição no mesmo lugar; o lápis ao lado
          é só reforço visual de que dá pra clicar (ver nota antiga sobre
          botão só-ícone ser difícil de notar, CLAUDE.md), não o único jeito
          de chegar lá.

          IMPORTANTE: o editável é a META (goalValue), nunca o Alcançado
          (achievedValue, dado de venda de verdade, não dá pra editar) — o
          lápis/clique mora JUNTO da linha "de R$ X", não perto do número
          grande de cima. Uma 1ª versão grudava o lápis no número grande
          (Alcançado) só porque ele é o mais vistoso da tela, e isso lia
          como "estou editando o valor vendido" (relatado pelo usuário, com
          print). */}
      {editing ? (
        <div className="mt-3">
          <label className="field-label">Meta do mês</label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {/* `bare`: edita no mesmo tamanho da linha "de R$ X" que ela
                substitui (texto comum, não o número grande de Alcançado
                acima) — pedido explícito: "a fonte está muito grande".
                Mesmo contorno (`ring-2 ring-brand/30`, sem background/borda
                de campo de formulário) que InlineEditableText já usa no
                editor da proposta (ver proposal-document.tsx) — sem
                `ring-offset`: o fundo do card aqui é vidro translúcido
                (.card, 68% branco), não branco sólido como a página da
                proposta, e o offset deixaria um halo branco errado em vez
                de se misturar. */}
            {/* prefixClassName + paddingLeft andam JUNTOS (ver nota em
                CurrencyInput) — "R$" em text-base (16px) a partir de left-3
                (12px) termina perto de 33px; 2.75rem (44px) de padding
                deixa folga de verdade antes do número começar, em vez de
                colar o "R$" em cima do primeiro dígito (aconteceu: um
                tamanho de "R$", padding calculado pra outro). */}
            <CurrencyInput
              value={draft}
              onChange={setDraft}
              onKeyDown={handleEditKeyDown}
              autoFocus
              bare
              prefixClassName="text-base"
              className="w-44 cursor-text rounded-md text-lg font-semibold text-neutral-900 ring-2 ring-brand/30 dark:text-neutral-100"
              style={{ paddingLeft: "2.75rem" }}
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="btn-primary btn-sm"
              aria-label="Salvar meta"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
              ) : (
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
              )}
              Salvar
            </button>
            <button
              type="button"
              onClick={cancelEditing}
              disabled={saving}
              className="btn-ghost btn-sm"
              aria-label="Cancelar edição"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
              Cancelar
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
      ) : !hasGoal ? (
        <div className="mt-3">
          {isOwner ? (
            <button
              type="button"
              onClick={startEditing}
              className="group -ml-1 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
            >
              <span className="text-lg font-semibold text-neutral-400 dark:text-neutral-500">
                Definir meta
              </span>
              <Pencil
                className="h-3.5 w-3.5 shrink-0 text-neutral-300 transition-colors group-hover:text-neutral-500 dark:text-neutral-600 dark:group-hover:text-neutral-400"
                strokeWidth={2}
              />
            </button>
          ) : (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              O dono ainda não definiu uma meta pra este mês.
            </p>
          )}
          {isOwner && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
              <span>
                Sugestão: {formatCurrency(suggestedValue)} ({sellerCount} consultor{sellerCount === 1 ? "" : "es"} ativo
                {sellerCount === 1 ? "" : "s"} × {formatCurrency(1_200_000)})
              </span>
              <button
                type="button"
                onClick={() => saveGoal(suggestedValue)}
                disabled={saving}
                className="font-medium text-neutral-700 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900 disabled:opacity-50 dark:text-neutral-300 dark:decoration-neutral-600 dark:hover:text-neutral-100"
              >
                {saving ? "Salvando…" : "Usar esta meta"}
              </button>
            </div>
          )}
          {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {isOwner && goalBasisChanged && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400 dark:text-neutral-500">
              <span>
                Equipe mudou pra {sellerCount} consultor{sellerCount === 1 ? "" : "es"} ativo
                {sellerCount === 1 ? "" : "s"} — sugestão: {formatCurrency(suggestedValue)}
              </span>
              <button
                type="button"
                onClick={() => saveGoal(suggestedValue)}
                disabled={saving}
                className="font-medium underline decoration-neutral-300 underline-offset-2 hover:text-neutral-700 disabled:opacity-50 dark:decoration-neutral-600 dark:hover:text-neutral-300"
              >
                {saving ? "Salvando…" : "Atualizar"}
              </button>
            </div>
          )}
          {/* Celular: valor + "de meta" em cima (o "de" desce pra linha de baixo em vez de espremer), ritmo à esquerda e % à direita numa linha só. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between">
            <div className="min-w-0">
              {/* Alcançado: só TEXTO, nunca um botão — é dado de venda real,
                  não existe "editar" aqui (ver nota grande acima). */}
              <span className="block text-2xl font-semibold tabular-nums text-neutral-900 sm:text-3xl dark:text-neutral-100">
                {formatCurrency(achievedValue)}
              </span>
              {/* A META é o editável — o lápis mora AQUI, junto da linha
                  "de R$ X", não perto do Alcançado acima. */}
              {isOwner ? (
                <button
                  type="button"
                  onClick={startEditing}
                  className="group -ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                >
                  <span className="text-sm font-medium text-neutral-400 dark:text-neutral-500">
                    de {formatCurrency(goalValue)}
                  </span>
                  <Pencil
                    className="h-3 w-3 shrink-0 text-neutral-300 transition-colors group-hover:text-neutral-500 dark:text-neutral-600 dark:group-hover:text-neutral-400"
                    strokeWidth={2}
                  />
                </button>
              ) : (
                <span className="block text-sm font-medium text-neutral-400 dark:text-neutral-500">
                  de {formatCurrency(goalValue)}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              {!exceeded && (
                <Badge tone={PACE_TONE[paceStatus]} dot title={`Meta batida: ${pct}% · Mês decorrido: ${pacePct}%`}>
                  {PACE_LABEL[paceStatus]}
                </Badge>
              )}
              <span
                className={`text-xl font-bold tabular-nums sm:text-2xl ${
                  exceeded ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-900 dark:text-neutral-100"
                }`}
              >
                {pct}%
              </span>
            </div>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

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
