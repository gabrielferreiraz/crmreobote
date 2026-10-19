"use client";

import { useState } from "react";
import { Modal } from "@/components/modal";
import { Select } from "@/components/select";
import { LoadingDots } from "@/components/loading-dots";
import { requestJson } from "@/lib/client-request";
import { formatCurrency } from "@/lib/format";
import { EXAMPLE_SALE, ruleSentence } from "@/lib/commissions/describe";
import { buildSaleSchedule, resolveAdministrator, type AdministratorBaseLike, type BeneficiaryRole, type Modality } from "@/lib/commissions/engine";
import { Choices, Question } from "./question";
import { Sentence } from "./sentence";

export type RuleForm = {
  id?: string;
  beneficiaryRole: BeneficiaryRole;
  userId: string | null;
  administratorId: string | null;
  modality: Modality | null;
  creditType: string | null;
  base: "NET" | "GROSS" | "COMPANY_REVENUE";
  percent: string;
};

const ROLE_PLURAL: Record<BeneficiaryRole, string> = { SELLER: "Todos os vendedores", SUPERVISOR: "Todos os supervisores", MANAGER: "Todos os gerentes" };

/**
 * "Quanto ganha" como perguntas em sequência — quem recebe, de quem,
 * em qual administradora, quanto. Embaixo, a regra vira a MESMA frase que
 * aparece na lista ("Todo vendedor ganha 1% do valor líquido nas vendas da
 * Servopa.") e o valor em reais numa venda de exemplo.
 */
export function RuleDialog({
  initial,
  members,
  administrators,
  creditTypes,
  onClose,
  onSaved,
}: {
  initial: RuleForm;
  members: { id: string; name: string; role: "OWNER" | "MANAGER" | "SUPERVISOR" | "MEMBER" }[];
  /** Cadastro completo (com as tabelas) — a prévia usa a tabela da categoria escolhida. */
  administrators: (AdministratorBaseLike & { name: string })[];
  creditTypes: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [scope, setScope] = useState<"all" | "one">(initial.userId ? "one" : "all");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const percentNum = Number(form.percent.replace(",", "."));
  const validPercent = Number.isFinite(percentNum) && percentNum > 0 && percentNum <= 100;
  const needsPerson = scope === "one" && !form.userId;

  // Supervisor/gerente: só quem tem esse papel (mais quem já estava na
  // regra, caso a pessoa tenha mudado de papel depois).
  const personOptions = members.filter(
    (m) =>
      form.beneficiaryRole === "SELLER" ||
      m.id === form.userId ||
      (form.beneficiaryRole === "SUPERVISOR" ? m.role === "SUPERVISOR" : m.role === "MANAGER"),
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validPercent || needsPerson) return;
    setSaving(true);
    setError(null);
    const res = await requestJson(
      initial.id ? `/api/commissions/rules/${initial.id}` : "/api/commissions/rules",
      { method: initial.id ? "PATCH" : "POST", json: { ...form, userId: scope === "one" ? form.userId : null, percent: percentNum } },
      { silent: true },
    );
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved();
  }

  // Prévia em reais, pelo MESMO motor da comissão de verdade, só com esta
  // regra: o que a corretora recebe na administradora escolhida e quanto
  // esta regra paga, numa venda de exemplo.
  const chosenBase = administrators.find((a) => a.id === form.administratorId) ?? null;
  const resolved = chosenBase ? resolveAdministrator(chosenBase, form.creditType) : null;
  const chosenAdministrator = chosenBase && resolved ? { ...resolved, name: chosenBase.name } : null;
  const roleIds = { SELLER: "__seller", SUPERVISOR: "__supervisor", MANAGER: "__manager" };
  if (scope === "one" && form.userId) roleIds[form.beneficiaryRole] = form.userId;
  const example =
    validPercent && chosenAdministrator
      ? buildSaleSchedule(
          {
            sellerId: roleIds.SELLER,
            supervisorId: roleIds.SUPERVISOR,
            managerId: roleIds.MANAGER,
            administratorId: chosenAdministrator.id,
            modality: form.modality ?? "FULL",
            creditType: form.creditType,
            saleDate: new Date(),
            netValue: EXAMPLE_SALE.value,
            grossValue: EXAMPLE_SALE.value,
            clientInstallment: EXAMPLE_SALE.clientInstallment,
          },
          chosenAdministrator,
          [
            {
              id: "preview",
              beneficiaryRole: form.beneficiaryRole,
              userId: scope === "one" ? form.userId : null,
              administratorId: chosenAdministrator.id,
              modality: form.modality,
              creditType: form.creditType,
              base: form.base,
              percent: percentNum,
              active: true,
              updatedAt: new Date(),
            },
          ],
        )
      : null;
  const exampleRevenue = example ? example.revenue.reduce((acc, r) => acc + r.amountCents, 0) / 100 : 0;
  const examplePay = example ? example.installments.reduce((acc, i) => acc + i.amountCents, 0) / 100 : 0;
  const whoGets = form.beneficiaryRole === "SELLER" ? "ao vendedor" : form.beneficiaryRole === "SUPERVISOR" ? "ao supervisor" : "ao gerente";

  const preview = ruleSentence({
    beneficiaryRole: form.beneficiaryRole,
    userName: scope === "one" ? (members.find((m) => m.id === form.userId)?.name ?? "…") : null,
    administratorName: administrators.find((a) => a.id === form.administratorId)?.name ?? null,
    modality: form.modality,
    creditType: form.creditType,
    base: form.base,
    percent: validPercent ? percentNum : 0,
  });

  return (
    <Modal onClose={() => !saving && onClose()} maxWidth="max-w-lg">
      <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{initial.id ? "Editar regra" : "Nova regra de comissão"}</h2>
      <form onSubmit={submit} className="mt-5 space-y-6">
        <Question title="Quem recebe">
          <Choices
            columns={3}
            value={form.beneficiaryRole}
            onChange={(v) => {
              setForm((f) => ({ ...f, beneficiaryRole: v, userId: null }));
              setScope("all");
            }}
            options={[
              { value: "SELLER", label: "O vendedor" },
              { value: "SUPERVISOR", label: "O supervisor" },
              { value: "MANAGER", label: "O gerente" },
            ]}
          />
        </Question>

        <Question title="Para quem">
          <Choices
            value={scope}
            onChange={(v) => {
              setScope(v);
              if (v === "all") setForm((f) => ({ ...f, userId: null }));
            }}
            options={[
              { value: "all", label: ROLE_PLURAL[form.beneficiaryRole] },
              { value: "one", label: "Uma pessoa só" },
            ]}
          />
          {scope === "one" && (
            <Select
              value={form.userId ?? ""}
              onChange={(v) => setForm((f) => ({ ...f, userId: v || null }))}
              options={personOptions.map((m) => ({ value: m.id, label: m.name }))}
              placeholder="Escolha a pessoa"
              ariaLabel="Pessoa"
            />
          )}
        </Question>

        <Question title="Administradora">
          <Select
            value={form.administratorId ?? ""}
            onChange={(v) => setForm((f) => ({ ...f, administratorId: v || null }))}
            options={[{ value: "", label: "Qualquer uma" }, ...administrators.map((a) => ({ value: a.id, label: a.name }))]}
            ariaLabel="Administradora"
          />
        </Question>

        {creditTypes.length > 0 && (
          <Question title="Categoria">
            <Choices
              columns={3}
              value={form.creditType ?? "__all"}
              onChange={(v) => setForm((f) => ({ ...f, creditType: v === "__all" ? null : v }))}
              options={[{ value: "__all", label: "Todas" }, ...creditTypes.map((c) => ({ value: c, label: c }))]}
            />
          </Question>
        )}

        <Question title="Quanto">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-32">
              <input
                inputMode="decimal"
                className="field-input pr-8 text-right text-lg font-semibold"
                value={form.percent}
                onChange={(e) => setForm((f) => ({ ...f, percent: e.target.value }))}
                placeholder="1,00"
                aria-label="Percentual"
                aria-invalid={form.percent !== "" && !validPercent}
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-base text-neutral-400">%</span>
            </div>
            <div className="min-w-[16rem] flex-1">
              <Choices
                value={form.base}
                onChange={(v) => setForm((f) => ({ ...f, base: v }))}
                columns={3}
                options={[
                  { value: "NET", label: "do valor líquido" },
                  { value: "GROSS", label: "do valor bruto" },
                  { value: "COMPANY_REVENUE", label: "da receita" },
                ]}
              />
            </div>
          </div>
          {form.percent.trim() !== "" && !validPercent && (
            <p className="field-error text-sm">Entre 0 e 100 (ex.: 1,5).</p>
          )}
        </Question>

        <Question title="Tipo de parcela">
          <Choices
            columns={3}
            value={form.modality ?? "ANY"}
            onChange={(v) => setForm((f) => ({ ...f, modality: v === "ANY" ? null : v }))}
            options={[
              { value: "ANY", label: "Qualquer" },
              { value: "FULL", label: "Cheia" },
              { value: "REDUCED", label: "Meia" },
            ]}
          />
        </Question>

        <div className="space-y-1 rounded-xl bg-brand-light px-4 py-3">
          <Sentence parts={preview} className="text-neutral-800 dark:text-neutral-200" />
          {validPercent && chosenAdministrator && example && (
            <p className="text-sm text-neutral-700 dark:text-neutral-300">
              {chosenAdministrator.revenueMode === "CLIENT_INSTALLMENT_TABLE"
                ? `Numa venda com parcela de ${formatCurrency(EXAMPLE_SALE.clientInstallment)} e crédito de ${formatCurrency(EXAMPLE_SALE.value)}`
                : `Numa venda de ${formatCurrency(EXAMPLE_SALE.value)}`}
              {exampleRevenue > 0 ? (
                <>
                  , a {chosenAdministrator.name} paga <strong className="font-semibold">{formatCurrency(exampleRevenue)}</strong> para a corretora
                </>
              ) : null}
              {examplePay > 0 ? (
                <>
                  {exampleRevenue > 0 ? " e esta regra paga " : ", esta regra paga "}
                  <strong className="font-semibold">{formatCurrency(examplePay)}</strong> {whoGets}.
                </>
              ) : form.base === "COMPANY_REVENUE" ? (
                <>. Falta cadastrar quanto a {chosenAdministrator.name} paga.</>
              ) : (
                "."
              )}
            </p>
          )}
          {validPercent && !chosenAdministrator && (
            <p className="text-sm text-neutral-700 dark:text-neutral-300">
              {form.base === "COMPANY_REVENUE" ? (
                "Depende de cada administradora."
              ) : (
                <>
                  Numa venda de {formatCurrency(EXAMPLE_SALE.value)}, isso dá{" "}
                  <strong className="font-semibold">{formatCurrency((EXAMPLE_SALE.value * percentNum) / 100)}</strong>.
                </>
              )}
            </p>
          )}
        </div>

        {error && <p className="field-error text-sm">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !validPercent || needsPerson}>
            {saving ? <LoadingDots /> : "Salvar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
