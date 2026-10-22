"use client";

import { useRef, useState } from "react";
import { CheckCircle2, CircleAlert, X } from "lucide-react";
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

function FormSectionHeading({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
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
  const [showValidation, setShowValidation] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const percentNum = Number(form.percent.replace(",", "."));
  const validPercent = Number.isFinite(percentNum) && percentNum > 0 && percentNum <= 100;
  const needsPerson = scope === "one" && !form.userId;
  const pendingItems = [!validPercent ? "percentual" : null, needsPerson ? "pessoa" : null].filter(
    (item): item is string => item !== null,
  );

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
    setShowValidation(true);
    if (!validPercent || needsPerson) {
      setError(null);
      requestAnimationFrame(() => {
        const target = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus({ preventScroll: true });
      });
      return;
    }
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
    <Modal
      onClose={() => !saving && onClose()}
      maxWidth="max-w-3xl"
      mobileSheet
      panelClassName="!flex !h-[90dvh] !flex-col !overflow-hidden !p-0 lg:!h-[min(90vh,48rem)]"
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            {initial.id ? "Editar regra" : "Nova regra"}
          </h2>
          <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
            Defina quem recebe e como calcular.
          </p>
        </div>
        <button type="button" className="icon-btn shrink-0" onClick={onClose} disabled={saving} aria-label="Fechar">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <form ref={formRef} onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="scrollbar-thin min-h-0 flex-1 divide-y divide-neutral-200 overflow-y-auto px-5 dark:divide-neutral-800">
          <section className="py-6">
            <FormSectionHeading number={1} title="Quem recebe" description="Escolha a função e a abrangência." />
            <div className="grid gap-6 md:grid-cols-2">
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
                      id="commission-person"
                      value={form.userId ?? ""}
                      onChange={(v) => setForm((f) => ({ ...f, userId: v || null }))}
                      options={personOptions.map((m) => ({ value: m.id, label: m.name }))}
                      placeholder="Selecione a pessoa"
                      ariaLabel="Pessoa"
                      invalid={showValidation && needsPerson}
                      describedBy="commission-person-error"
                    />
                    {showValidation && needsPerson && (
                      <p id="commission-person-error" className="field-error text-sm">Escolha quem receberá.</p>
                    )}
                  </div>
                )}
              </Question>
            </div>
          </section>

          <section className="py-6">
            <FormSectionHeading number={2} title="Em quais vendas" description="Delimite onde esta regra será usada." />
            <div className="grid gap-6 sm:grid-cols-2">
              <Question title="Administradora">
                <Select
                  value={form.administratorId ?? ""}
                  onChange={(v) => setForm((f) => ({ ...f, administratorId: v || null }))}
                  options={[{ value: "", label: "Todas as administradoras" }, ...administrators.map((a) => ({ value: a.id, label: a.name }))]}
                  ariaLabel="Administradora"
                />
              </Question>

              <Question title="Tipo de parcela">
                <Choices
                  columns={3}
                  mobileColumns={3}
                  value={form.modality ?? "ANY"}
                  onChange={(v) => setForm((f) => ({ ...f, modality: v === "ANY" ? null : v }))}
                  options={[
                    { value: "ANY", label: "Todas" },
                    { value: "FULL", label: "Cheia" },
                    { value: "REDUCED", label: "Meia" },
                  ]}
                />
              </Question>
            </div>

            {creditTypes.length > 0 && (
              <div className="mt-6">
                <Question title="Categoria">
                  <Choices
                    columns={3}
                    mobileColumns={2}
                    value={form.creditType ?? "__all"}
                    onChange={(v) => setForm((f) => ({ ...f, creditType: v === "__all" ? null : v }))}
                    options={[{ value: "__all", label: "Todas" }, ...creditTypes.map((c) => ({ value: c, label: c }))]}
                  />
                </Question>
              </div>
            )}
          </section>

          <section className="py-6">
            <FormSectionHeading number={3} title="Valor da comissão" description="Informe o percentual e a base de cálculo." />
            <div className="grid items-start gap-6 sm:grid-cols-[9rem_minmax(0,1fr)]">
              <Question title="Percentual" required>
                <div className="relative">
                  <input
                    id="commission-percent"
                    inputMode="decimal"
                    className="field-input h-12 pr-9 text-right text-xl font-semibold tabular-nums"
                    value={form.percent}
                    onChange={(e) => setForm((f) => ({ ...f, percent: e.target.value }))}
                    placeholder="1,5"
                    aria-label="Percentual"
                    aria-invalid={(showValidation || form.percent !== "") && !validPercent ? true : undefined}
                    aria-describedby={!validPercent ? "commission-percent-error" : undefined}
                  />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-base font-medium text-neutral-400">%</span>
                </div>
                {!validPercent && (
                  <p
                    id="commission-percent-error"
                    className={`text-sm ${showValidation || form.percent !== "" ? "field-error" : "text-neutral-500 dark:text-neutral-400"}`}
                  >
                    Use um valor entre 0 e 100.
                  </p>
                )}
              </Question>

              <Question title="Base de cálculo">
                <Choices
                  value={form.base}
                  onChange={(v) => setForm((f) => ({ ...f, base: v }))}
                  columns={3}
                  options={[
                    { value: "NET", label: "Valor líquido" },
                    { value: "GROSS", label: "Valor bruto" },
                    { value: "COMPANY_REVENUE", label: "Receita da empresa" },
                  ]}
                />
              </Question>
            </div>

            <div className="mt-6 space-y-1.5 border-l-2 border-brand pl-4">
              <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">Resumo da regra</p>
              <Sentence parts={preview} className="text-neutral-800 dark:text-neutral-200" />
              {validPercent && chosenAdministrator && example && (
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  {chosenAdministrator.revenueMode === "CLIENT_INSTALLMENT_TABLE"
                    ? `Em uma venda com parcela de ${formatCurrency(EXAMPLE_SALE.clientInstallment)} e crédito de ${formatCurrency(EXAMPLE_SALE.value)}`
                    : `Em uma venda de ${formatCurrency(EXAMPLE_SALE.value)}`}
                  {exampleRevenue > 0 ? (
                    <>
                      , a {chosenAdministrator.name} paga <strong className="font-semibold text-neutral-800 dark:text-neutral-200">{formatCurrency(exampleRevenue)}</strong> para a corretora
                    </>
                  ) : null}
                  {examplePay > 0 ? (
                    <>
                      {exampleRevenue > 0 ? " e esta regra paga " : ", esta regra paga "}
                      <strong className="font-semibold text-neutral-800 dark:text-neutral-200">{formatCurrency(examplePay)}</strong> {whoGets}.
                    </>
                  ) : form.base === "COMPANY_REVENUE" ? (
                    <>. Falta cadastrar quanto a {chosenAdministrator.name} paga.</>
                  ) : (
                    "."
                  )}
                </p>
              )}
              {validPercent && !chosenAdministrator && (
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  {form.base === "COMPANY_REVENUE" ? (
                    "O valor depende da administradora da venda."
                  ) : (
                    <>
                      Em uma venda de {formatCurrency(EXAMPLE_SALE.value)}, o pagamento seria de{" "}
                      <strong className="font-semibold text-neutral-800 dark:text-neutral-200">
                        {formatCurrency((EXAMPLE_SALE.value * percentNum) / 100)}
                      </strong>.
                    </>
                  )}
                </p>
              )}
            </div>
          </section>

          {error && (
            <p className="field-error my-4 flex items-start gap-1.5 text-sm" role="alert">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
        </div>

        <footer className="flex shrink-0 flex-col gap-3 border-t border-neutral-200 px-5 pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:flex-row sm:items-center sm:justify-between lg:pb-4 dark:border-neutral-800">
          <p
            className={`flex min-w-0 items-center gap-1.5 text-sm ${
              pendingItems.length > 0
                ? "text-amber-700 dark:text-amber-300"
                : "text-emerald-700 dark:text-emerald-300"
            }`}
          >
            {pendingItems.length > 0 ? (
              <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate">
              {pendingItems.length > 0
                ? `Falta preencher: ${pendingItems.join(" e ")}`
                : "Regra pronta para salvar"}
            </span>
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
