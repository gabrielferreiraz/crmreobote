"use client";

import { useRef, useState } from "react";
import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { Modal } from "@/components/modal";
import { LoadingDots } from "@/components/loading-dots";
import { requestJson } from "@/lib/client-request";
import { formatCurrency } from "@/lib/format";
import { addMonths, brazilMonthKey, buildRevenueSchedule, formatMonthLong, type CommissionTableLike, type UnpaidPolicy } from "@/lib/commissions/engine";
import { EXAMPLE_SALE } from "@/lib/commissions/describe";
import { Choices, Question } from "./question";
import { parseWholeNumber, WholeNumberInput } from "./whole-number-input";
import { CommissionTableEditor, draftError, draftFromTable, draftToTable, type TableDraft } from "./commission-table-editor";

export type AdministratorForm = {
  id?: string;
  name: string;
  active: boolean;
  graceMonths: number;
  cutoffDay: number | null;
  paysSellerDirectly: boolean;
  unpaidPolicy: UnpaidPolicy;
  /** Sempre com a padrão (creditType null) + as de cada categoria que paga diferente. */
  tables: CommissionTableLike[];
};

export const EMPTY_ADMINISTRATOR: AdministratorForm = {
  name: "",
  active: true,
  graceMonths: 1,
  cutoffDay: null,
  paysSellerDirectly: false,
  // O mais comum (explicado pelo Financeiro): o consultor recebe todas as parcelas, no ritmo em que o cliente paga.
  unpaidPolicy: "DEFER",
  tables: [],
};

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
 * Cadastro de administradora como uma conversa, de cima pra baixo:
 *  1. nome;
 *  2. se ela paga igual em todas as categorias — se não, uma tabela padrão
 *     e uma tabela própria pra cada categoria que paga diferente (Imóvel,
 *     Automóvel…): em quantas vezes, parcelas sem comissão, quanto paga pra
 *     corretora (ver CommissionTableEditor);
 *  3. o que vale pra administradora inteira: quando sai a 1ª parcela, dia
 *     de corte, quem paga o consultor e o que acontece quando o cliente não
 *     paga a parcela do mês.
 * No fim, "na prática" numa venda de exemplo, em reais.
 */
export function AdministratorDialog({
  initial,
  creditTypes,
  onClose,
  onSaved,
}: {
  initial: AdministratorForm;
  creditTypes: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // "Trava até pagar" saiu das opções (funciona como "recebe quando o cliente pagar").
  const [form, setForm] = useState<AdministratorForm>({ ...initial, unpaidPolicy: initial.unpaidPolicy === "HOLD" ? "DEFER" : initial.unpaidPolicy });
  const [hasCutoff, setHasCutoff] = useState(initial.cutoffDay != null);
  const [cutoffText, setCutoffText] = useState(String(initial.cutoffDay ?? 25));
  const initialDefault = initial.tables.find((t) => t.creditType === null) ?? null;
  const [defaultDraft, setDefaultDraft] = useState<TableDraft>(draftFromTable(initialDefault, null));
  // Uma entrada por categoria cadastrada: rascunho próprio (ou null = segue a padrão).
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, TableDraft | null>>(() =>
    Object.fromEntries(
      creditTypes.map((c) => {
        const own = initial.tables.find((t) => t.creditType && t.creditType.toLocaleLowerCase("pt-BR") === c.toLocaleLowerCase("pt-BR"));
        return [c, own ? draftFromTable(own, c) : null];
      }),
    ),
  );
  const [byCategory, setByCategory] = useState(Object.values(categoryDrafts).some(Boolean));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const cutoffDay = parseWholeNumber(cutoffText, 1, 31);
  const cutoffError = hasCutoff && cutoffDay == null ? "Dia de 1 a 31." : null;
  const ownCategories = byCategory ? Object.entries(categoryDrafts).filter((e): e is [string, TableDraft] => !!e[1]) : [];
  const tablesError = draftError(defaultDraft) ?? ownCategories.map(([c, d]) => (draftError(d) ? `${c}: ${draftError(d)}` : null)).find(Boolean) ?? null;
  const blocked = !form.name.trim() || !!cutoffError || !!tablesError;
  const pendingItems = [
    !form.name.trim() ? "nome" : null,
    tablesError ? "dados da comissão" : null,
    cutoffError ? "dia de corte" : null,
  ].filter((item): item is string => item !== null);
  const name = form.name.trim() || "a administradora";

  // "Na prática" da tabela padrão, numa venda de exemplo fechada hoje.
  const defaultTable = draftToTable(defaultDraft);
  const firstMonth = addMonths(brazilMonthKey(), form.graceMonths);
  const lastMonth = addMonths(firstMonth, defaultTable.commissionInstallments - 1);
  const exampleRevenue =
    defaultTable.revenueMode && !draftError(defaultDraft)
      ? buildRevenueSchedule(
          { saleDate: new Date(), netValue: EXAMPLE_SALE.value, grossValue: EXAMPLE_SALE.value, clientInstallment: EXAMPLE_SALE.clientInstallment },
          { id: "preview", graceMonths: form.graceMonths, cutoffDay: null, paysSellerDirectly: form.paysSellerDirectly, unpaidPolicy: form.unpaidPolicy, ...defaultTable },
        ).installments.reduce((acc, r) => acc + r.amountCents, 0) / 100
      : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setShowValidation(true);
    if (blocked) {
      setError(null);
      requestAnimationFrame(() => {
        const target = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid-section="true"]');
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (target?.matches("input, select, textarea, button")) target.focus({ preventScroll: true });
      });
      return;
    }
    setSaving(true);
    setError(null);
    const res = await requestJson(
      initial.id ? `/api/commissions/administrators/${initial.id}` : "/api/commissions/administrators",
      {
        method: initial.id ? "PATCH" : "POST",
        json: {
          name: form.name.trim(),
          active: form.active,
          graceMonths: form.graceMonths,
          cutoffDay: hasCutoff ? cutoffDay : null,
          paysSellerDirectly: form.paysSellerDirectly,
          unpaidPolicy: form.unpaidPolicy,
          tables: [draftToTable(defaultDraft), ...ownCategories.map(([, d]) => draftToTable(d))],
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
    <Modal
      onClose={() => !saving && onClose()}
      maxWidth="max-w-3xl"
      panelClassName="!flex !h-[90vh] !flex-col !overflow-hidden !p-0"
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            {initial.id ? `Editar ${initial.name}` : "Cadastrar administradora"}
          </h2>
          <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
            Preencha os dados usados no cálculo das comissões.
          </p>
          <p
            className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${
              pendingItems.length > 0
                ? "text-amber-700 dark:text-amber-300"
                : "text-emerald-700 dark:text-emerald-300"
            }`}
          >
            {pendingItems.length > 0 ? (
              <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {pendingItems.length > 0
              ? `${pendingItems.length} ${pendingItems.length === 1 ? "pendência" : "pendências"}`
              : "Pronto para salvar"}
          </p>
        </div>
        <button type="button" className="icon-btn shrink-0" onClick={onClose} disabled={saving} aria-label="Fechar">
          <X className="h-4 w-4" />
        </button>
      </header>

      <form ref={formRef} onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="scrollbar-thin min-h-0 flex-1 divide-y divide-neutral-200 overflow-y-auto px-5 dark:divide-neutral-800">
        <section className="py-6">
          <FormSectionHeading number={1} title="Identificação" description="Comece pelo nome da administradora." />
          <Question title="Nome da administradora" required>
            <input
              className="field-input text-base"
              value={form.name}
              maxLength={80}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ex.: Servopa"
              autoFocus
              aria-label="Nome da administradora"
              aria-invalid={showValidation && !form.name.trim() ? true : undefined}
            />
            {!form.name.trim() && (
              <p className={`text-sm ${showValidation ? "field-error" : "text-neutral-500 dark:text-neutral-400"}`}>
                Digite o nome para continuar.
              </p>
            )}
          </Question>
          {initial.id && (
            <div className="mt-5 max-w-sm">
              <Question title="Administradora ativa?">
                <Choices
                  value={form.active ? "yes" : "no"}
                  onChange={(v) => setForm((f) => ({ ...f, active: v === "yes" }))}
                  options={[
                    { value: "yes", label: "Sim" },
                    { value: "no", label: "Não" },
                  ]}
                />
              </Question>
            </div>
          )}
        </section>

        <section className="py-6">
          <FormSectionHeading
            number={2}
            title="Comissão da corretora"
            description="Informe como e quanto a administradora paga."
          />
          <div className="space-y-6">

        {creditTypes.length > 0 && (
          <Question title={`${name.charAt(0).toUpperCase()}${name.slice(1)} paga igual em todas as categorias?`}>
            <Choices
              value={byCategory ? "no" : "yes"}
              onChange={(v) => setByCategory(v === "no")}
              options={[
                { value: "yes", label: "Sim" },
                { value: "no", label: "Não, muda por categoria" },
              ]}
            />
          </Question>
        )}

        <section
          className={byCategory ? "space-y-4 border-l-2 border-neutral-200 pl-4 dark:border-neutral-700" : ""}
          data-invalid-section={showValidation && !!draftError(defaultDraft) ? "true" : undefined}
        >
          {byCategory && (
            <div>
              <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Tabela padrão</h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">Para categorias sem tabela própria.</p>
            </div>
          )}
          <CommissionTableEditor draft={defaultDraft} onChange={setDefaultDraft} name={name} showValidation={showValidation} />
        </section>

        {byCategory &&
          creditTypes.map((category) => {
            const draft = categoryDrafts[category];
            return (
              <section
                key={category}
                className="space-y-4 border-l-2 border-neutral-200 pl-4 dark:border-neutral-700"
                data-invalid-section={showValidation && !!draft && !!draftError(draft) ? "true" : undefined}
              >
                <Question title={`${category}: igual à padrão?`}>
                  <Choices
                    value={draft ? "own" : "default"}
                    onChange={(v) =>
                      setCategoryDrafts((prev) => ({
                        ...prev,
                        // Tabela própria nasce como cópia da padrão — é só mudar o que difere.
                        [category]: v === "own" ? { ...defaultDraft, creditType: category } : null,
                      }))
                    }
                    options={[
                      { value: "default", label: "Sim" },
                      { value: "own", label: "Tabela própria" },
                    ]}
                  />
                </Question>
                {draft && (
                  <CommissionTableEditor
                    draft={draft}
                    onChange={(next) => setCategoryDrafts((prev) => ({ ...prev, [category]: next }))}
                    name={`${name} (${category})`}
                    showValidation={showValidation}
                  />
                )}
              </section>
            );
          })}
          </div>
        </section>

        <section className="py-6">
          <FormSectionHeading
            number={3}
            title="Repasse e pagamento"
            description="Defina quando e em quais condições o consultor recebe."
          />
          <div className="grid gap-6 sm:grid-cols-2">

        <Question title="1ª parcela">
          <Choices
            columns={2}
            value={String(Math.min(form.graceMonths, 3))}
            onChange={(v) => setForm((f) => ({ ...f, graceMonths: Number(v) }))}
            options={[
              { value: "0", label: "Mesmo mês" },
              { value: "1", label: "Mês seguinte" },
              { value: "2", label: "2 meses depois" },
              { value: "3", label: "3 meses depois" },
            ]}
          />
        </Question>

        <Question title="Dia de corte?">
          <Choices
            value={hasCutoff ? "yes" : "no"}
            onChange={(v) => setHasCutoff(v === "yes")}
            options={[
              { value: "no", label: "Não" },
              { value: "yes", label: "Sim" },
            ]}
          />
          {hasCutoff && (
            <div className="space-y-1.5 pt-1">
              <label className="flex flex-wrap items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                Depois do dia
                <WholeNumberInput value={cutoffText} onChange={setCutoffText} invalid={!!cutoffError} ariaLabel="Dia de corte" />
                vai para o mês seguinte
              </label>
              {cutoffError && <p className="field-error text-sm">{cutoffError}</p>}
            </div>
          )}
        </Question>

        <Question title="Quem paga o consultor?">
          <Choices
            value={form.paysSellerDirectly ? "adm" : "company"}
            onChange={(v) => setForm((f) => ({ ...f, paysSellerDirectly: v === "adm" }))}
            options={[
              { value: "company", label: "A empresa" },
              { value: "adm", label: "A administradora" },
            ]}
          />
        </Question>

        <Question title="Se o cliente não pagar a parcela">
          <Choices
            value={form.unpaidPolicy}
            onChange={(v) => setForm((f) => ({ ...f, unpaidPolicy: v }))}
            options={[
              { value: "DEFER", label: "Recebe quando o cliente pagar" },
              { value: "FORFEIT", label: "Consultor perde" },
              { value: "IGNORE", label: "Não muda nada" },
            ]}
          />
          {form.unpaidPolicy !== "IGNORE" && (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">Conferido todo mês em Pagamentos.</p>
          )}
        </Question>
          </div>

        <div className="mt-6 space-y-1 border-l-2 border-brand pl-4 text-sm text-neutral-700 dark:text-neutral-300">
          <p>
            <strong className="font-semibold">Na prática{byCategory ? " (tabela padrão)" : ""}:</strong>{" "}
            {exampleRevenue != null ? (
              <>
                {defaultTable.revenueMode === "CLIENT_INSTALLMENT_TABLE"
                  ? `numa venda com parcela de ${formatCurrency(EXAMPLE_SALE.clientInstallment)} fechada hoje`
                  : `numa venda de ${formatCurrency(EXAMPLE_SALE.value)} fechada hoje`}
                , {name} paga <strong>{formatCurrency(exampleRevenue)}</strong> para a corretora
              </>
            ) : (
              <>comissão paga</>
            )}
            {defaultTable.commissionInstallments === 1 ? (
              <>
                {" "}
                em <strong>{formatMonthLong(firstMonth)}</strong>.
              </>
            ) : (
              <>
                {" "}
                em <strong>{defaultTable.commissionInstallments - defaultTable.skippedInstallments.length} parcelas</strong>, de{" "}
                <strong>{formatMonthLong(firstMonth)}</strong> até <strong>{formatMonthLong(lastMonth)}</strong>.
              </>
            )}
          </p>
          <p>{form.paysSellerDirectly ? "Consultor recebe direto da administradora." : "Empresa paga no ritmo em que recebe."}</p>
        </div>
        </section>

        {error && (
          <p className="field-error my-4 flex items-start gap-1.5 text-sm" role="alert">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
        </div>

        <footer className="flex shrink-0 flex-col gap-3 border-t border-neutral-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-neutral-800">
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
                ? `${pendingItems.length} ${pendingItems.length === 1 ? "pendência" : "pendências"}: ${pendingItems.join(", ")}`
                : "Todos os dados obrigatórios foram preenchidos"}
            </span>
          </p>
          <div className="flex shrink-0 justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <LoadingDots /> : initial.id ? "Salvar alterações" : "Cadastrar"}
            </button>
          </div>
        </footer>
      </form>
    </Modal>
  );
}
