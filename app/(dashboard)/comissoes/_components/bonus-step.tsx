"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Plus, Sparkles } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Select } from "@/components/select";
import { CurrencyInput } from "@/components/currency-input";
import { LoadingDots } from "@/components/loading-dots";
import { requestJson } from "@/lib/client-request";
import { formatCurrency } from "@/lib/format";
import { addMonths, formatMonthLong, type BeneficiaryRole } from "@/lib/commissions/engine";
import { BonusRuleDialog, emptyBonusTier, type BonusRuleForm, type BonusTierForm } from "./bonus-rule-dialog";

export type BonusTier = { id: string; thresholdPercent: number; rewardType: "FIXED" | "PERCENT"; rewardValue: number };
export type BonusRule = { id: string; beneficiaryRole: BeneficiaryRole; userId: string | null; userName: string | null; active: boolean; tiers: BonusTier[] };
type Member = { id: string; name: string };

const ROLE_LABEL: Record<BeneficiaryRole, string> = { SELLER: "vendedor", SUPERVISOR: "supervisor", MANAGER: "gerente" };

function tierRewardLabel(t: Pick<BonusTier, "rewardType" | "rewardValue">): string {
  return t.rewardType === "FIXED"
    ? `ganha ${formatCurrency(t.rewardValue)}`
    : `ganha +${t.rewardValue.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}% nas vendas do mês`;
}

/** "Todo vendedor que bater 100% da meta ganha R$ 1.000,00; 120% ganha +0,5% nas vendas do mês." */
function bonusRuleSentence(rule: Pick<BonusRule, "beneficiaryRole" | "userName" | "tiers">): string {
  const who = rule.userName ? rule.userName : `Todo ${ROLE_LABEL[rule.beneficiaryRole]} que bater`;
  const parts = [...rule.tiers]
    .sort((a, b) => a.thresholdPercent - b.thresholdPercent)
    .map((t) => `${t.thresholdPercent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% da meta ${tierRewardLabel(t)}`);
  return `${who} ${parts.join("; ")}.`;
}

function tierFormFrom(tier: BonusTier): BonusTierForm {
  return {
    key: tier.id,
    thresholdPercent: tier.thresholdPercent.toLocaleString("pt-BR", { maximumFractionDigits: 2 }),
    rewardType: tier.rewardType,
    rewardValue: tier.rewardValue.toLocaleString("pt-BR", { maximumFractionDigits: 4 }).replace(/\./g, ""),
  };
}

/**
 * Bônus por meta batida: metas individuais (por pessoa, por mês) + regras
 * (% da meta → prêmio, ver BonusRuleDialog) + "Calcular bônus do mês"
 * (manual, nunca automático — o Financeiro decide quando rodar). O prêmio
 * concedido vira um lançamento normal (ADJUSTMENT) em "Minha comissão" —
 * esta tela só configura e dispara o cálculo.
 */
export function BonusStep({
  currentMonth,
  rules: initialRules,
  initialGoals,
  members,
}: {
  currentMonth: string;
  rules: BonusRule[];
  /** Metas do mês atual (currentMonth) já carregadas pelo servidor — outros meses buscam sob demanda. */
  initialGoals: { userId: string; value: number }[];
  members: Member[];
}) {
  const router = useRouter();
  const [rules, setRules] = useState(initialRules);
  const [ruleDialog, setRuleDialog] = useState<BonusRuleForm | null>(null);
  const [deletingRule, setDeletingRule] = useState<{ id: string; label: string } | null>(null);

  const [goalMonth, setGoalMonth] = useState(currentMonth);
  // Cache por mês — evita rebuscar o mês atual (já veio do servidor) e
  // guarda o que já foi buscado ao trocar de mês e voltar.
  const [goalsByMonth, setGoalsByMonth] = useState<Record<string, Record<string, number>>>(() => ({
    [currentMonth]: Object.fromEntries(initialGoals.map((g) => [g.userId, g.value])),
  }));
  const goals = goalsByMonth[goalMonth] ?? {};
  // Carregando = o mês escolhido ainda não está em cache — sem estado
  // próprio (deriva do que já foi buscado), não precisa de setState extra.
  const loadingGoals = !goalsByMonth[goalMonth];

  useEffect(() => {
    if (goalsByMonth[goalMonth]) return; // já em cache — nada pra buscar.
    const controller = new AbortController();
    (async () => {
      const res = await requestJson<{ userId: string; value: number }[]>(`/api/commissions/individual-goals?month=${goalMonth}`, {
        signal: controller.signal,
      });
      if (res.aborted) return; // tela trocou de mês de novo antes de voltar — o próximo disparo do efeito cuida do mês atual.
      // Falhou (sem ser cancelamento)? Guarda vazio mesmo assim — senão
      // "carregando" nunca sai da tela e ninguém consegue nem tentar de novo
      // (trocar de mês e voltar já tenta a busca de novo).
      setGoalsByMonth((g) => ({ ...g, [goalMonth]: res.ok ? Object.fromEntries(res.data.map((x) => [x.userId, x.value])) : {} }));
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalMonth]);

  const [savingGoal, setSavingGoal] = useState<string | null>(null);

  async function saveGoal(userId: string, value: number) {
    setSavingGoal(userId);
    const res = await requestJson(
      "/api/commissions/individual-goals",
      { method: "PATCH", json: { userId, month: goalMonth, value: value || null } },
      { silent: true },
    );
    setSavingGoal(null);
    if (res.ok) setGoalsByMonth((g) => ({ ...g, [goalMonth]: { ...(g[goalMonth] ?? {}), [userId]: value } }));
  }

  function newRule() {
    setRuleDialog({ beneficiaryRole: "SELLER", userId: null, tiers: [emptyBonusTier()] });
  }

  function savedRule() {
    setRuleDialog(null);
    router.refresh();
  }

  const monthOptions = Array.from({ length: 15 }, (_, i) => addMonths(currentMonth, i - 2)).map((m) => ({ value: m, label: formatMonthLong(m) }));

  return (
    <div className="card min-w-0 space-y-6 p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
          <Sparkles className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Bônus por meta</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Prêmio extra pra quem bate a própria meta do mês — opcional.</p>
        </div>
      </div>

      {/* Regras */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Regras</h3>
        {rules.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Nenhuma regra de bônus cadastrada.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {rules.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <p className="min-w-0 flex-1 text-sm text-neutral-800 dark:text-neutral-200">{bonusRuleSentence(rule)}</p>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() =>
                      setRuleDialog({
                        id: rule.id,
                        beneficiaryRole: rule.beneficiaryRole,
                        userId: rule.userId,
                        tiers: rule.tiers.map(tierFormFrom),
                      })
                    }
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => setDeletingRule({ id: rule.id, label: `Excluir a regra de "${rule.userName ?? ROLE_LABEL[rule.beneficiaryRole]}"?` })}
                  >
                    Excluir
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="btn-ghost btn-sm -ml-3 text-brand" onClick={newRule}>
          <Plus className="h-4 w-4" strokeWidth={2} />
          Adicionar regra de bônus
        </button>
      </div>

      {/* Metas individuais */}
      <div className="space-y-3 border-t border-neutral-200 pt-6 dark:border-neutral-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Metas individuais</h3>
          <Select value={goalMonth} onChange={setGoalMonth} options={monthOptions} ariaLabel="Mês da meta" className="w-48" />
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Quanto cada pessoa precisa vender pra bater 100% da meta em {formatMonthLong(goalMonth).toLowerCase()}. Quem não tem meta aqui não entra no cálculo do bônus.
        </p>
        {members.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Nenhum membro ativo.</p>
        ) : (
          <ul className="scrollbar-thin max-h-96 divide-y divide-neutral-100 overflow-y-auto rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm text-neutral-800 dark:text-neutral-200">{m.name}</span>
                <div className="w-40 shrink-0">
                  <CurrencyInput
                    value={loadingGoals ? "" : goals[m.id] != null ? String(goals[m.id]) : ""}
                    onChange={(v) =>
                      setGoalsByMonth((g) => ({ ...g, [goalMonth]: { ...(g[goalMonth] ?? {}), [m.id]: v ? Number(v) : 0 } }))
                    }
                    onBlur={() => saveGoal(m.id, goals[m.id] ?? 0)}
                    className="h-9 text-sm"
                  />
                </div>
                {savingGoal === m.id && <LoadingDots />}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Calcular */}
      <CalculateBonusCard currentMonth={currentMonth} />

      {ruleDialog && <BonusRuleDialog initial={ruleDialog} members={members} onClose={() => setRuleDialog(null)} onSaved={savedRule} />}
      {deletingRule && (
        <ConfirmDialog
          title={deletingRule.label}
          confirmLabel="Excluir"
          onClose={() => setDeletingRule(null)}
          onConfirm={async () => {
            const res = await requestJson(`/api/commissions/bonus-rules/${deletingRule.id}`, { method: "DELETE" });
            setDeletingRule(null);
            if (res.ok) {
              setRules((r) => r.filter((x) => x.id !== deletingRule.id));
              router.refresh();
            }
          }}
        />
      )}
    </div>
  );
}

type CalcResultItem = { beneficiaryId: string; beneficiaryName: string; achievedPercent: number; tierThresholdPercent: number; amount: number };
type CalcResult = {
  awarded: CalcResultItem[];
  skippedNoGoal: { beneficiaryId: string; beneficiaryName: string }[];
  skippedBelowThreshold: { beneficiaryId: string; beneficiaryName: string; achievedPercent: number }[];
  alreadyAwarded: { beneficiaryId: string; beneficiaryName: string }[];
};

function CalculateBonusCard({ currentMonth }: { currentMonth: string }) {
  const [month, setMonth] = useState(currentMonth);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CalcResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const monthOptions = Array.from({ length: 15 }, (_, i) => addMonths(currentMonth, i - 2)).map((m) => ({ value: m, label: formatMonthLong(m) }));
  const total = result ? result.awarded.reduce((sum, a) => sum + a.amount, 0) : 0;

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    const res = await requestJson<CalcResult>("/api/commissions/bonus-rules/calculate", { method: "POST", json: { month } }, { silent: true });
    setRunning(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult(res.data);
  }

  return (
    <div className="space-y-3 border-t border-neutral-200 pt-6 dark:border-neutral-800">
      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Calcular bônus do mês</h3>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Confere quem bateu a meta e lança o prêmio como um ajuste de comissão (aparece em &quot;Minha comissão&quot; de cada um). Rodar de novo no mesmo
        mês nunca paga duas vezes.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={month} onChange={setMonth} options={monthOptions} ariaLabel="Mês a calcular" className="w-48" />
        <button type="button" className="btn-primary btn-sm" onClick={run} disabled={running}>
          {running ? <LoadingDots /> : "Calcular bônus"}
        </button>
      </div>
      {error && (
        <p className="flex items-start gap-2 text-sm font-medium text-red-700 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
          {error}
        </p>
      )}
      {result && (
        <div className="space-y-2 rounded-xl bg-brand-light px-4 py-3">
          <p className="flex items-start gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} />
            {result.awarded.length === 0 ? "Nenhum prêmio novo" : `${result.awarded.length} prêmio${result.awarded.length === 1 ? "" : "s"} concedido${result.awarded.length === 1 ? "" : "s"}, total ${formatCurrency(total)}`}
          </p>
          {result.awarded.map((a) => (
            <p key={a.beneficiaryId} className="text-sm text-neutral-700 dark:text-neutral-300">
              {a.beneficiaryName}: bateu {a.achievedPercent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% da meta (faixa de{" "}
              {a.tierThresholdPercent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%) — {formatCurrency(a.amount)}
            </p>
          ))}
          {result.alreadyAwarded.length > 0 && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{result.alreadyAwarded.length} já tinham bônus calculado neste mês.</p>
          )}
          {result.skippedNoGoal.length > 0 && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{result.skippedNoGoal.length} sem meta cadastrada neste mês.</p>
          )}
          {result.skippedBelowThreshold.length > 0 && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{result.skippedBelowThreshold.length} ainda não bateram a primeira faixa.</p>
          )}
        </div>
      )}
    </div>
  );
}
