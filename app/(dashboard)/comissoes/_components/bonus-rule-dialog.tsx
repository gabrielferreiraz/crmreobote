"use client";

import { useState } from "react";
import { CheckCircle2, CircleAlert, Plus, Trash2, X } from "lucide-react";
import { Modal } from "@/components/modal";
import { Select } from "@/components/select";
import { CurrencyInput } from "@/components/currency-input";
import { LoadingDots } from "@/components/loading-dots";
import { requestJson } from "@/lib/client-request";
import type { BeneficiaryRole } from "@/lib/commissions/engine";
import { Choices, Question } from "./question";

export type BonusTierForm = {
  key: string;
  thresholdPercent: string;
  rewardType: "FIXED" | "PERCENT";
  rewardValue: string;
};

export type BonusRuleForm = {
  id?: string;
  beneficiaryRole: BeneficiaryRole;
  userId: string | null;
  tiers: BonusTierForm[];
};

const ROLE_PLURAL: Record<BeneficiaryRole, string> = { SELLER: "Todos os vendedores", SUPERVISOR: "Todos os supervisores", MANAGER: "Todos os gerentes" };

export function emptyBonusTier(): BonusTierForm {
  return { key: Math.random().toString(36).slice(2), thresholdPercent: "", rewardType: "FIXED", rewardValue: "" };
}

function FormSectionHeading({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <span className="pt-0.5 text-xs font-semibold tabular-nums text-neutral-400">{String(number).padStart(2, "0")}</span>
      <div>
        <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>
        <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">{description}</p>
      </div>
    </div>
  );
}

/**
 * Regra de bônus por meta batida — mesmo "quem recebe" de RuleDialog, mas em
 * vez de % sobre a venda, paga um prêmio quando a pessoa bate um % da
 * PRÓPRIA meta individual no mês (cadastrada à parte, ver IndividualGoalsCard).
 * Várias faixas por regra: só a mais alta atingida paga (nunca soma).
 */
export function BonusRuleDialog({
  initial,
  members,
  onClose,
  onSaved,
}: {
  initial: BonusRuleForm;
  members: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [scope, setScope] = useState<"all" | "one">(initial.userId ? "one" : "all");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);

  const needsPerson = scope === "one" && !form.userId;
  const tierErrors = form.tiers.map((t) => {
    const threshold = Number(t.thresholdPercent.replace(",", "."));
    const value = Number(t.rewardValue.replace(",", "."));
    if (!Number.isFinite(threshold) || threshold <= 0) return "% da meta inválido";
    if (!Number.isFinite(value) || value <= 0) return "Valor do prêmio inválido";
    if (t.rewardType === "PERCENT" && value > 100) return "Até 100%";
    return null;
  });
  const thresholds = form.tiers.map((t) => t.thresholdPercent.trim());
  const hasDuplicateThreshold = new Set(thresholds).size !== thresholds.length;
  const validTiers = form.tiers.length > 0 && tierErrors.every((e) => !e) && !hasDuplicateThreshold;
  const pendingItems = [
    needsPerson ? "pessoa" : null,
    form.tiers.length === 0 ? "pelo menos uma faixa" : !validTiers ? "faixas com erro" : null,
  ].filter((i): i is string => i !== null);

  function updateTier(key: string, patch: Partial<BonusTierForm>) {
    setForm((f) => ({ ...f, tiers: f.tiers.map((t) => (t.key === key ? { ...t, ...patch } : t)) }));
  }
  function removeTier(key: string) {
    setForm((f) => ({ ...f, tiers: f.tiers.filter((t) => t.key !== key) }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setShowValidation(true);
    if (needsPerson || !validTiers) {
      setError(null);
      return;
    }
    setSaving(true);
    setError(null);
    const res = await requestJson(
      initial.id ? `/api/commissions/bonus-rules/${initial.id}` : "/api/commissions/bonus-rules",
      {
        method: initial.id ? "PATCH" : "POST",
        json: {
          beneficiaryRole: form.beneficiaryRole,
          userId: scope === "one" ? form.userId : null,
          tiers: form.tiers.map((t) => ({
            thresholdPercent: Number(t.thresholdPercent.replace(",", ".")),
            rewardType: t.rewardType,
            rewardValue: Number(t.rewardValue.replace(",", ".")),
          })),
        },
      },
      { silent: true },
    );
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved();
  }

  return (
    <Modal onClose={() => !saving && onClose()} maxWidth="max-w-3xl" mobileSheet panelClassName="!flex !h-[90dvh] !flex-col !overflow-hidden !p-0 lg:!h-[min(90vh,46rem)]">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-neutral-200 px-7 py-5 dark:border-neutral-800">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold text-neutral-900 dark:text-neutral-100">{initial.id ? "Editar regra de bônus" : "Nova regra de bônus"}</h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Prêmio por bater um % da meta individual do mês.</p>
        </div>
        <button type="button" className="icon-btn shrink-0" onClick={onClose} disabled={saving} aria-label="Fechar">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="scrollbar-thin min-h-0 flex-1 divide-y divide-neutral-200 overflow-y-auto px-7 dark:divide-neutral-800">
          <section className="py-7">
            <FormSectionHeading number={1} title="Quem recebe" description="Escolha a função e a abrangência." />
            <div className="grid gap-8 md:grid-cols-2">
              <Question title="Função">
                <Choices
                  columns={3}
                  mobileColumns={3}
                  value={form.beneficiaryRole}
                  onChange={(v) => {
                    setForm((f) => ({ ...f, beneficiaryRole: v, userId: null }));
                    setScope("all");
                  }}
                  options={[
                    { value: "SELLER", label: "Vendedor" },
                    { value: "SUPERVISOR", label: "Supervisor" },
                    { value: "MANAGER", label: "Gerente" },
                  ]}
                />
              </Question>

              <Question title="Abrangência" required={scope === "one"}>
                <Choices
                  value={scope}
                  onChange={(v) => {
                    setScope(v);
                    if (v === "all") setForm((f) => ({ ...f, userId: null }));
                  }}
                  options={[
                    { value: "all", label: ROLE_PLURAL[form.beneficiaryRole] },
                    { value: "one", label: "Uma pessoa" },
                  ]}
                />
                {scope === "one" && (
                  <div className="space-y-1.5 pt-1">
                    <Select
                      value={form.userId ?? ""}
                      onChange={(v) => setForm((f) => ({ ...f, userId: v || null }))}
                      options={members.map((m) => ({ value: m.id, label: m.name }))}
                      placeholder="Selecione a pessoa"
                      ariaLabel="Pessoa"
                      invalid={showValidation && needsPerson}
                    />
                    {showValidation && needsPerson && <p className="field-error text-sm">Escolha quem receberá.</p>}
                  </div>
                )}
              </Question>
            </div>
          </section>

          <section className="py-7">
            <FormSectionHeading number={2} title="Faixas da meta" description="Cada faixa é um degrau: % da meta batida → prêmio. Só a faixa mais alta atingida paga." />
            <div className="space-y-3">
              {form.tiers.map((tier, i) => (
                <div key={tier.key} className="flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                  <div className="w-28 space-y-1">
                    <label className="field-label">% da meta</label>
                    <div className="relative">
                      <input
                        inputMode="decimal"
                        className="field-input h-11 pr-7 text-right tabular-nums"
                        value={tier.thresholdPercent}
                        onChange={(e) => updateTier(tier.key, { thresholdPercent: e.target.value })}
                        placeholder="100"
                        aria-label={`% da meta da faixa ${i + 1}`}
                        aria-invalid={showValidation && !!tierErrors[i] ? true : undefined}
                      />
                      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-neutral-400">%</span>
                    </div>
                  </div>

                  <div className="w-52 space-y-1">
                    <label className="field-label">Prêmio</label>
                    <Choices
                      columns={2}
                      value={tier.rewardType}
                      onChange={(v) => updateTier(tier.key, { rewardType: v, rewardValue: "" })}
                      options={[
                        { value: "FIXED", label: "Valor fixo" },
                        { value: "PERCENT", label: "% extra" },
                      ]}
                    />
                  </div>

                  <div className="min-w-40 flex-1 space-y-1">
                    <label className="field-label">{tier.rewardType === "FIXED" ? "Valor" : "Percentual extra"}</label>
                    {tier.rewardType === "FIXED" ? (
                      <CurrencyInput value={tier.rewardValue} onChange={(v) => updateTier(tier.key, { rewardValue: v })} className="h-11" />
                    ) : (
                      <div className="relative">
                        <input
                          inputMode="decimal"
                          className="field-input h-11 pr-7 text-right tabular-nums"
                          value={tier.rewardValue}
                          onChange={(e) => updateTier(tier.key, { rewardValue: e.target.value })}
                          placeholder="0,5"
                          aria-label={`Percentual extra da faixa ${i + 1}`}
                        />
                        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-neutral-400">%</span>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    className="icon-btn mb-0.5 shrink-0 text-neutral-500 hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400"
                    onClick={() => removeTier(tier.key)}
                    aria-label="Remover faixa"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={2} />
                  </button>

                  {showValidation && tierErrors[i] && <p className="field-error w-full text-sm">{tierErrors[i]}</p>}
                </div>
              ))}

              {showValidation && hasDuplicateThreshold && <p className="field-error text-sm">Duas faixas não podem ter o mesmo % da meta.</p>}

              <button
                type="button"
                className="btn-ghost btn-sm text-brand"
                onClick={() => setForm((f) => ({ ...f, tiers: [...f.tiers, emptyBonusTier()] }))}
              >
                <Plus className="h-4 w-4" strokeWidth={2} />
                Adicionar faixa
              </button>
            </div>
          </section>

          {error && (
            <p className="field-error my-4 flex items-start gap-1.5 text-sm" role="alert">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
        </div>

        <footer className="flex shrink-0 flex-col gap-3 border-t border-neutral-200 px-7 pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:flex-row sm:items-center sm:justify-between lg:pb-4 dark:border-neutral-800">
          <p className={`flex min-w-0 items-center gap-1.5 text-sm ${pendingItems.length > 0 ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>
            {pendingItems.length > 0 ? <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />}
            <span className="truncate">{pendingItems.length > 0 ? `Falta preencher: ${pendingItems.join(" e ")}` : "Regra pronta para salvar"}</span>
          </p>
          <div className="flex shrink-0 justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary min-w-28" disabled={saving}>
              {saving ? <LoadingDots /> : initial.id ? "Salvar alterações" : "Criar regra"}
            </button>
          </div>
        </footer>
      </form>
    </Modal>
  );
}
