"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, Plus, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Select } from "@/components/select";
import { Switch } from "@/components/switch";
import { LoadingDots } from "@/components/loading-dots";
import { requestJson } from "@/lib/client-request";
import { addMonths, formatMonthLong, ruleSpecificity, type BeneficiaryRole, type Modality, type RuleLike } from "@/lib/commissions/engine";
import { administratorSentence, exampleSplit, exampleSplitSentences, ruleSentence, type SentencePart } from "@/lib/commissions/describe";
import { AdministratorDialog, EMPTY_ADMINISTRATOR, type AdministratorForm } from "./administrator-dialog";
import { RuleDialog, type RuleForm } from "./rule-dialog";
import { Choices, Question } from "./question";
import { Sentence } from "./sentence";
import { parseWholeNumber, WholeNumberInput } from "./whole-number-input";

type Administrator = AdministratorForm & { id: string; salesCount: number };
type Rule = {
  id: string;
  beneficiaryRole: BeneficiaryRole;
  userId: string | null;
  userName: string | null;
  administratorId: string | null;
  modality: Modality | null;
  creditType: string | null;
  base: "NET" | "GROSS" | "COMPANY_REVENUE";
  percent: number;
};
type Member = { id: string; name: string; role: "OWNER" | "MANAGER" | "SUPERVISOR" | "MEMBER"; canManageCommissions: boolean };

const ROLE_ORDER: Record<BeneficiaryRole, number> = { SELLER: 0, SUPERVISOR: 1, MANAGER: 2 };

/**
 * Configuração em 3 passos numerados, cada um uma pergunta. Tudo que já foi
 * cadastrado aparece como FRASE ("Todo vendedor ganha 1% do valor líquido
 * nas vendas da Servopa.") — quem configura lê e confere, sem decifrar
 * etiqueta. Pedido explícito: "algo direto pra quem não entende nada de
 * tecnologia e quer configurar rápido".
 */
export function SettingsView({
  currentMonth,
  startMonth,
  payDay,
  sellerPastMonths,
  administrators,
  rules,
  members,
  creditTypes,
  isOwner,
}: {
  currentMonth: string;
  startMonth: string | null;
  payDay: number;
  sellerPastMonths: number;
  administrators: Administrator[];
  rules: Rule[];
  members: Member[];
  creditTypes: string[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [admDialog, setAdmDialog] = useState<AdministratorForm | null>(null);
  const [ruleDialog, setRuleDialog] = useState<RuleForm | null>(null);
  const [deleting, setDeleting] = useState<{ kind: "administrator" | "rule"; id: string; title: string } | null>(null);
  const [rulesChanged, setRulesChanged] = useState(false);

  function savedConfig() {
    setAdmDialog(null);
    setRuleDialog(null);
    setRulesChanged(true);
    router.refresh();
  }

  function newRule(administratorId: string | null) {
    setRuleDialog({ beneficiaryRole: "SELLER", userId: null, administratorId, modality: null, creditType: null, base: "NET", percent: "" });
  }

  const activeAdministrators = administrators.filter((a) => a.active);
  const sortRules = (list: Rule[]) =>
    [...list].sort((a, b) => ROLE_ORDER[a.beneficiaryRole] - ROLE_ORDER[b.beneficiaryRole] || ruleSpecificity(a) - ruleSpecificity(b));
  const generalRules = sortRules(rules.filter((r) => r.administratorId === null));
  // Regras no formato do motor — pra conta "na prática" de cada administradora.
  const engineRules: RuleLike[] = rules.map((r) => ({ ...r, active: true, updatedAt: new Date(0) }));
  const practiceFor = (a: Administrator): SentencePart[][] =>
    exampleSplitSentences(
      exampleSplit(a, engineRules.filter((r) => r.administratorId === a.id || r.administratorId === null)),
      a.name,
      a.revenueMode,
    );
  const generalSellerRule = generalRules.some((r) => r.beneficiaryRole === "SELLER" && !r.userId && !r.modality && !r.creditType);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Link href="/comissoes" className="icon-btn" aria-label="Voltar para Comissões">
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          </Link>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Configurar comissões</h1>
        </div>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          São 3 passos. Os consultores só começam a ver as comissões depois do passo 3.
        </p>
      </div>

      {rulesChanged && <RecalculateBanner onDone={() => setRulesChanged(false)} />}

      {/* Passo 1 */}
      <Step number={1} done={activeAdministrators.length > 0} title="Quais administradoras vocês vendem?">
        {administrators.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Nenhuma cadastrada ainda. Comece pela que vocês mais vendem.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {administrators.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{a.name}</p>
                  {a.active ? (
                    <Sentence parts={administratorSentence(a)} className="mt-0.5" />
                  ) : (
                    <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">Vocês não vendem mais. Não aparece no Ganho.</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setAdmDialog(a)}>
                    Editar
                  </button>
                  {a.salesCount === 0 && (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setDeleting({ kind: "administrator", id: a.id, title: `Excluir ${a.name}?` })}>
                      Excluir
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="btn-secondary" onClick={() => setAdmDialog({ ...EMPTY_ADMINISTRATOR })}>
          <Plus className="h-4 w-4" strokeWidth={2} />
          Cadastrar administradora
        </button>
      </Step>

      {/* Passo 2 */}
      <Step number={2} done={rules.length > 0} title="Quanto cada um ganha?">
        {administrators.length === 0 && rules.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Cadastre as administradoras primeiro (passo 1).</p>
        ) : (
          <div className="space-y-4">
            {activeAdministrators.map((a) => {
              const own = sortRules(rules.filter((r) => r.administratorId === a.id));
              const hasSellerRule = generalSellerRule || own.some((r) => r.beneficiaryRole === "SELLER" && !r.userId && !r.modality && !r.creditType);
              return (
                <RuleGroup
                  key={a.id}
                  title={`Vendas da ${a.name}`}
                  rules={own}
                  administratorName={a.name}
                  empty={
                    own.length === 0 && generalRules.length > 0
                      ? "Sem regra própria: vale a regra de qualquer administradora, mais abaixo."
                      : null
                  }
                  warning={!hasSellerRule ? `Ainda não existe regra para todo vendedor nas vendas da ${a.name}.` : null}
                  practice={practiceFor(a)}
                  onAdd={() => newRule(a.id)}
                  addLabel={`Adicionar regra para a ${a.name}`}
                  onEdit={(r) => setRuleDialog({ ...r, percent: String(r.percent).replace(".", ",") })}
                  onDelete={(r) => setDeleting({ kind: "rule", id: r.id, title: "Excluir esta regra?" })}
                />
              );
            })}
            {administrators
              .filter((a) => !a.active && rules.some((r) => r.administratorId === a.id))
              .map((a) => (
                <RuleGroup
                  key={a.id}
                  title={`Vendas da ${a.name} (não vendem mais)`}
                  rules={sortRules(rules.filter((r) => r.administratorId === a.id))}
                  administratorName={a.name}
                  onEdit={(r) => setRuleDialog({ ...r, percent: String(r.percent).replace(".", ",") })}
                  onDelete={(r) => setDeleting({ kind: "rule", id: r.id, title: "Excluir esta regra?" })}
                />
              ))}
            <RuleGroup
              title="Vendas de qualquer administradora"
              rules={generalRules}
              administratorName={null}
              empty="Nenhuma regra geral. Use para o que vale igual em todas (ex.: o supervisor)."
              onAdd={() => newRule(null)}
              addLabel="Adicionar regra para qualquer administradora"
              onEdit={(r) => setRuleDialog({ ...r, percent: String(r.percent).replace(".", ",") })}
              onDelete={(r) => setDeleting({ kind: "rule", id: r.id, title: "Excluir esta regra?" })}
            />
            {rules.length > 0 && (
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Se duas regras servirem para a mesma venda, vale a mais específica. A regra de uma pessoa vale mais que a regra de todos.
              </p>
            )}
          </div>
        )}
      </Step>

      {/* Passo 3 */}
      <StartStep currentMonth={currentMonth} startMonth={startMonth} payDay={payDay} sellerPastMonths={sellerPastMonths} />

      {isOwner && <ManagersStep members={members} />}

      {admDialog && <AdministratorDialog initial={admDialog} onClose={() => setAdmDialog(null)} onSaved={savedConfig} />}
      {ruleDialog && (
        <RuleDialog
          initial={ruleDialog}
          members={members}
          administrators={administrators.filter((a) => a.active || a.id === ruleDialog.administratorId)}
          creditTypes={creditTypes}
          onClose={() => setRuleDialog(null)}
          onSaved={savedConfig}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={deleting.title}
          confirmLabel="Excluir"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const url = deleting.kind === "rule" ? `/api/commissions/rules/${deleting.id}` : `/api/commissions/administrators/${deleting.id}`;
            const res = await requestJson(url, { method: "DELETE" });
            setDeleting(null);
            if (res.ok) savedConfig();
          }}
        />
      )}
    </div>
  );
}

function RuleGroup({
  title,
  rules: groupRules,
  administratorName: groupAdministrator,
  empty = null,
  warning = null,
  practice,
  onAdd,
  addLabel,
  onEdit,
  onDelete,
}: {
  title: string;
  rules: Rule[];
  administratorName: string | null;
  empty?: string | null;
  warning?: string | null;
  /** "Na prática": quanto a corretora recebe, quanto vai pra cada um e quanto fica — numa venda de exemplo. */
  practice?: SentencePart[][];
  onAdd?: () => void;
  addLabel?: string;
  onEdit: (rule: Rule) => void;
  onDelete: (rule: Rule) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
      <div className="border-b border-neutral-100 bg-neutral-50 px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-800/40">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>
      </div>
      <div className="space-y-2 px-4 py-3">
        {groupRules.length === 0 && empty && <p className="text-sm text-neutral-600 dark:text-neutral-400">{empty}</p>}
        {warning && (
          <p className="flex items-start gap-2 text-sm font-medium text-amber-800 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
            {warning}
          </p>
        )}
        {groupRules.length > 0 && (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {groupRules.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Sentence
                  className="min-w-0 flex-1"
                  parts={ruleSentence({ ...rule, administratorName: groupAdministrator })}
                />
                <div className="flex shrink-0 gap-1">
                  <button type="button" className="btn-ghost btn-sm" onClick={() => onEdit(rule)}>
                    Editar
                  </button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => onDelete(rule)}>
                    Excluir
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {onAdd && (
          <button type="button" className="btn-ghost btn-sm -ml-3 text-brand" onClick={onAdd}>
            <Plus className="h-4 w-4" strokeWidth={2} />
            {addLabel}
          </button>
        )}
        {practice && practice.length > 1 && (
          <div className="space-y-0.5 rounded-xl bg-brand-light px-4 py-3">
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Na prática</p>
            {practice.map((line, i) => (
              <Sentence key={i} parts={line} className="text-neutral-800 dark:text-neutral-200" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Step({ number, done, title, children }: { number?: number; done?: boolean; title: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-4 p-5">
      <div className="flex items-center gap-3">
        {number != null && (
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
              done ? "bg-emerald-500 text-white" : "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
            }`}
            aria-label={done ? `Passo ${number} feito` : `Passo ${number}`}
          >
            {done ? <Check className="h-4 w-4" strokeWidth={3} /> : number}
          </span>
        )}
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
      </div>
      {children}
    </section>
  );
}

/** Passo 3: quando começa, dia do pagamento, o que o consultor vê — um "Salvar" só. */
function StartStep({
  currentMonth,
  startMonth,
  payDay,
  sellerPastMonths,
}: {
  currentMonth: string;
  startMonth: string | null;
  payDay: number;
  sellerPastMonths: number;
}) {
  const router = useRouter();
  const [start, setStart] = useState(startMonth ?? "");
  const [day, setDay] = useState(String(payDay));
  const [showPast, setShowPast] = useState(sellerPastMonths > 0 ? "yes" : "no");
  const [past, setPast] = useState(String(sellerPastMonths > 0 ? sellerPastMonths : 3));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startOptions = [
    { value: "", label: "Ainda não — estou montando" },
    ...Array.from({ length: 10 }, (_, i) => addMonths(currentMonth, i - 3)).map((m) => ({ value: m, label: `A partir de ${formatMonthLong(m).toLowerCase()}` })),
  ];
  if (startMonth && !startOptions.some((o) => o.value === startMonth)) {
    startOptions.splice(1, 0, { value: startMonth, label: `A partir de ${formatMonthLong(startMonth).toLowerCase()}` });
  }
  const pastValue = showPast === "yes" ? Number(past) : 0;
  const payDayValue = parseWholeNumber(day, 1, 31);
  const dayError = payDayValue == null ? "Digite o dia do pagamento, de 1 a 31." : null;
  const dirty = start !== (startMonth ?? "") || day !== String(payDay) || pastValue !== sellerPastMonths;

  async function save() {
    setSaving(true);
    setError(null);
    const res = await requestJson(
      "/api/commissions/settings",
      { method: "PATCH", json: { startMonth: start || null, payDay: payDayValue, sellerPastMonths: pastValue } },
      { silent: true },
    );
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <Step number={3} done={!!startMonth} title="Quando começar?">
      {startMonth && (
        <p className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
          <Check className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
          Ligado. Toda venda ganha desde {formatMonthLong(startMonth).toLowerCase()} vira comissão sozinha.
        </p>
      )}
      <div className="space-y-6">
        <Question title="A partir de que mês as vendas ganhas viram comissão?">
          <Select value={start} onChange={setStart} options={startOptions} ariaLabel="Mês de início" />
          {start && start < currentMonth && start !== startMonth && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
              Esse mês já passou. As vendas ganhas desde {formatMonthLong(start).toLowerCase()} entram na hora, e as parcelas dos meses que já
              passaram aparecem como atrasadas para você pagar ou ajustar.
            </p>
          )}
          {!start && (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Enquanto estiver em &quot;Ainda não&quot;, nada é calculado e os vendedores não veem nada. Escolha o mês quando os passos 1 e 2
              estiverem prontos.
            </p>
          )}
        </Question>

        <Question title="Em que dia do mês vocês pagam a comissão?">
          <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
            Todo dia
            <WholeNumberInput value={day} onChange={setDay} invalid={!!dayError} ariaLabel="Dia do pagamento" />
          </label>
          {dayError && <p className="field-error text-sm">{dayError}</p>}
        </Question>

        <Question title="O consultor pode ver os meses que já passaram?">
          <Choices
            value={showPast}
            onChange={setShowPast}
            options={[
              { value: "no", label: "Não, só deste mês em diante" },
              { value: "yes", label: "Sim, alguns meses" },
            ]}
          />
          {showPast === "yes" && (
            <Select
              value={past}
              onChange={setPast}
              ariaLabel="Quantos meses"
              options={[
                { value: "1", label: "O mês passado" },
                { value: "3", label: "Os últimos 3 meses" },
                { value: "6", label: "Os últimos 6 meses" },
                { value: "12", label: "Os últimos 12 meses" },
              ]}
            />
          )}
        </Question>
      </div>
      {error && <p className="field-error text-sm">{error}</p>}
      {dirty && (
        <div className="flex justify-end">
          <button type="button" className="btn-primary" onClick={save} disabled={saving || !!dayError}>
            {saving ? <LoadingDots /> : "Salvar"}
          </button>
        </div>
      )}
    </Step>
  );
}

/**
 * Depois de mexer em regra/administradora, venda já calculada NÃO muda
 * sozinha. Este aviso oferece aplicar às vendas que ainda não tiveram
 * nenhuma parcela paga (as já pagas ficam como estão).
 */
function RecalculateBanner({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  async function run() {
    setRunning(true);
    let total = 0;
    let afterId: string | null = null;
    for (let guard = 0; guard < 200; guard++) {
      const res: Awaited<ReturnType<typeof requestJson<{ updated: number; remaining: number; lastId: string | null }>>> = await requestJson(
        "/api/commissions/sales/recalculate",
        { method: "POST", json: afterId ? { afterId } : {} },
      );
      if (!res.ok) break;
      total += res.data.updated;
      afterId = res.data.lastId;
      if (res.data.remaining === 0 || !afterId) break;
    }
    setRunning(false);
    setDone(total);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/20 bg-brand-light px-4 py-3">
      <p className="text-sm text-neutral-800 dark:text-neutral-200">
        {done == null
          ? "Você mudou a configuração. Quer aplicar nas vendas que ainda não tiveram nenhuma parcela paga?"
          : done === 0
            ? "Pronto. Nenhuma venda precisava mudar."
            : `Pronto. ${done} ${done === 1 ? "venda foi atualizada" : "vendas foram atualizadas"}.`}
      </p>
      <div className="flex items-center gap-2">
        {done == null ? (
          <>
            <button type="button" className="btn-ghost btn-sm" onClick={onDone} disabled={running}>
              Não precisa
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={run} disabled={running}>
              {running ? (
                <LoadingDots />
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
                  Aplicar agora
                </>
              )}
            </button>
          </>
        ) : (
          <button type="button" className="btn-ghost btn-sm" onClick={onDone}>
            Fechar
          </button>
        )}
      </div>
    </div>
  );
}

/** Só o Dono vê: quem tem a visão da comissão de todo mundo. */
function ManagersStep({ members }: { members: Member[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const sorted = [...members].sort(
    (a, b) =>
      Number(b.role === "OWNER" || b.canManageCommissions) - Number(a.role === "OWNER" || a.canManageCommissions) ||
      a.name.localeCompare(b.name, "pt-BR"),
  );

  async function toggle(member: Member, canManage: boolean) {
    setPending(member.id);
    const res = await requestJson("/api/commissions/managers", { method: "PATCH", json: { userId: member.id, canManage } });
    setPending(null);
    if (res.ok) router.refresh();
  }

  return (
    <Step title="Quem cuida das comissões?">
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Quem estiver ligado aqui configura, confere e paga a comissão de todo mundo. Os donos sempre podem.
      </p>
      <ul className="scrollbar-thin max-h-80 divide-y divide-neutral-100 overflow-y-auto rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {sorted.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="truncate text-sm text-neutral-800 dark:text-neutral-200">{m.name}</span>
            {m.role === "OWNER" ? (
              <span className="text-sm text-neutral-500 dark:text-neutral-400">Dono, sempre pode</span>
            ) : (
              <Switch checked={m.canManageCommissions} disabled={pending === m.id} onChange={(v) => toggle(m, v)} label={`${m.name} cuida das comissões`} />
            )}
          </li>
        ))}
      </ul>
    </Step>
  );
}
