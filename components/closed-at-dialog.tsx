"use client";

import { useState, useEffect, useRef } from "react";
import { ArrowLeft, Check, CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { Modal } from "./modal";
import { LoadingDots } from "./loading-dots";
import { DatePicker } from "./date-picker";
import { Select } from "./select";
import { brazilDateKey } from "@/lib/timezone";
import { getServerTodayKey } from "@/app/actions/date-actions";
import { formatCurrency } from "@/lib/format";
import { formatMonthLong } from "@/lib/commissions/engine";
import { RegistrationForm, type RegistrationApi, type RegistrationStatus } from "@/components/deal-registration/registration-form";

type CommissionPreview =
  | { status: "inactive" }
  | { status: "pending"; sellerName: string; isMe: boolean; hasReducedRules: boolean }
  | {
      status: "ok";
      sellerName: string;
      isMe: boolean;
      hasReducedRules: boolean;
      total: number;
      count: number;
      firstMonth: string;
      lastMonth: string;
      paidByAdministrator: boolean;
    };

/**
 * Pergunta só a data de fechamento — usado tanto pra marcar Ganho de um
 * negócio só (negocios/[id]/deal-detail.tsx) quanto pro bulk "Marcar como
 * ganho" em massa (pipeline/deals-list.tsx, que passa `title`/`confirmLabel`
 * no plural). Extraído pra cá quando o bulk precisou do mesmo diálogo — só
 * havia 1 cópia, local ao detalhe do negócio, até então.
 *
 * O valor inicial do campo vem do SERVIDOR (getServerTodayKey), não do
 * relógio local do dispositivo — relógios de celular/PC podem estar errados
 * e causariam um closedAt gravado no dia errado (bug real: consultora com
 * relógio 1 dia atrasado, venda sumiu do ranking da TV).
 * Enquanto a resposta do servidor não chegou, o botão de confirmar fica
 * desabilitado — a espera típica é < 1s (1 round-trip), aceitável pra uma
 * ação de fechamento de negócio.
 *
 * `askAdministrator` (só no Ganho): pede também a administradora do
 * consórcio — módulo de Comissões. A lista vem do servidor ao abrir; se a
 * corretora não tem nenhuma administradora cadastrada (não usa Comissões),
 * o campo simplesmente não aparece e nada muda pra ela.
 *
 * `previewDealId` (Ganho de UM negócio): assim que a administradora é
 * escolhida, mostra quanto a venda vai render de comissão — o momento de
 * maior emoção do consultor, e também a hora de perceber que escolheu a
 * administradora errada. Mesmo motor da venda de comissão (ver
 * /api/commissions/preview), então o número é o mesmo que ele vê depois.
 */
export function ClosedAtDialog({
  title,
  confirmLabel,
  confirmClassName,
  onClose,
  onConfirm,
  askAdministrator = false,
  initialAdministratorId = null,
  initialCreditType = null,
  previewDealId,
  registrationDealId,
}: {
  title: string;
  confirmLabel: string;
  confirmClassName: string;
  onClose: () => void;
  onConfirm: (
    closedAt: string,
    extra: { administratorId: string | null; creditType: string | null; skipRegistrationReason?: string },
  ) => Promise<void>;
  askAdministrator?: boolean;
  initialAdministratorId?: string | null;
  /** Categoria (Imóvel, Automóvel…) que o negócio já tem — pré-seleciona. */
  initialCreditType?: string | null;
  previewDealId?: string;
  /** Ganho de UM negócio: pede também o cadastro do cliente (dados + documentos da administradora) antes de concluir. */
  registrationDealId?: string;
}) {
  // Fallback local enquanto a server action não respondeu — evita campo vazio
  // piscando, mas não permite confirmar com esse valor (ready=false).
  const [closedAt, setClosedAt] = useState(brazilDateKey());
  // Teto do calendário: nunca depois de HOJE (servidor) — sem isso, um
  // clique errado no dia seguinte no calendário grava um closedAt no futuro,
  // que nunca deixa de ser "o mais recente" pra TV/Relatórios (ORDER BY
  // closedAt DESC) até o calendário de verdade alcançar aquela data. Bug
  // real encontrado em produção (venda travada 5 dias "no futuro"). Mesma
  // fonte (servidor, não relógio do dispositivo) que já evita o problema
  // irmão (closedAt no passado por relógio atrasado, ver comentário acima).
  const [maxDate, setMaxDate] = useState(brazilDateKey());
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [administrators, setAdministrators] = useState<{ id: string; name: string }[]>([]);
  const [administratorId, setAdministratorId] = useState(initialAdministratorId ?? "");
  // Enquanto a lista não chegou, não deixa confirmar sem ela — senão um
  // clique rápido passaria sem a administradora e o servidor recusaria.
  const [administratorsReady, setAdministratorsReady] = useState(!askAdministrator);
  // Categoria muda a comissão inteira (% e em quantas vezes) — pedida junto
  // da administradora quando a corretora tem categorias cadastradas.
  const [creditTypes, setCreditTypes] = useState<string[]>([]);
  const [creditType, setCreditType] = useState(initialCreditType ?? "");

  useEffect(() => {
    getServerTodayKey()
      .then((serverDate) => {
        setClosedAt(serverDate);
        setMaxDate(serverDate);
        setReady(true);
      })
      .catch(() => {
        // Se a action falhar (rede, servidor fora), aceita o fallback local.
        setReady(true);
      });
  }, []);

  useEffect(() => {
    if (!askAdministrator) return;
    fetch("/api/commissions/administrators")
      .then((res) => (res.ok ? res.json() : { administrators: [] }))
      .then((data: { administrators?: { id: string; name: string }[]; creditTypes?: string[] }) => {
        const list = data.administrators ?? [];
        setAdministrators(list);
        setCreditTypes(data.creditTypes ?? []);
        // A que estava no negócio pode ter sido desativada — sem ela na lista, pede de novo.
        setAdministratorId((current) => (list.some((a) => a.id === current) ? current : ""));
      })
      .catch(() => setAdministrators([]))
      .finally(() => setAdministratorsReady(true));
  }, [askAdministrator]);

  const needsAdministrator = administrators.length > 0;
  // Com cadastro (Ganho de UM negócio): a janela vira dois passos — 1) a venda, 2) o cadastro do cliente.
  const registrationEnabled = !!registrationDealId && needsAdministrator;
  const [step, setStep] = useState<"sale" | "registration">("sale");
  const inRegistration = registrationEnabled && step === "registration" && !!administratorId;
  const [regStatus, setRegStatus] = useState<RegistrationStatus>({ loading: true, ready: false, summary: "", canBypass: false, done: 0, total: 0 });
  const regApi = useRef<RegistrationApi | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const needsCreditType = needsAdministrator && creditTypes.length > 0;

  const [preview, setPreview] = useState<CommissionPreview | null>(null);
  useEffect(() => {
    if (!previewDealId || !administratorId || !closedAt || !ready) return;
    const controller = new AbortController();
    const qs = new URLSearchParams({ dealId: previewDealId, administratorId, closedAt, ...(creditType ? { creditType } : {}) });
    fetch(`/api/commissions/preview?${qs}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: CommissionPreview | null) => setPreview(data))
      .catch(() => {});
    return () => controller.abort();
  }, [previewDealId, administratorId, closedAt, ready, creditType]);
  const shownPreview = administratorId ? preview : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (needsAdministrator && !administratorId) return;
    if (needsCreditType && !creditType) return;
    if (registrationEnabled && step === "sale") {
      setStep("registration");
      return;
    }
    if (registrationEnabled && !regStatus.ready) {
      // Em vez de um botão travado sem explicação: mostra o que falta e leva até lá.
      setShowErrors(true);
      regApi.current?.focusFirstMissing();
      return;
    }
    setLoading(true);
    setSubmitError(null);
    try {
      // Garante que o rascunho do cadastro chegou ao servidor antes do Ganho conferir.
      if (registrationEnabled && regApi.current && !(await regApi.current.flush())) {
        setSubmitError("Não foi possível salvar o cadastro. Tente de novo.");
        return;
      }
      await onConfirm(closedAt, {
        administratorId: needsAdministrator ? administratorId : null,
        creditType: needsCreditType ? creditType : null,
      });
    } finally {
      // Mesmo se a confirmação lançar, o botão volta — nunca fica girando pra sempre.
      setLoading(false);
    }
  }

  async function handleFinishLater() {
    if (savingDraft || loading) return;
    setSavingDraft(true);
    setSubmitError(null);
    try {
      if (regApi.current && !(await regApi.current.flush())) {
        setSubmitError("Não foi possível salvar o rascunho. Tente novamente.");
        return;
      }
      onClose();
    } finally {
      setSavingDraft(false);
    }
  }

  const adminName = administrators.find((a) => a.id === administratorId)?.name;
  const submitLabel = (
    <>
      {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
      {loading ? (
        <span className="inline-flex items-center gap-1">
          Salvando
          <LoadingDots />
        </span>
      ) : registrationEnabled && step === "sale" ? (
        "Continuar"
      ) : registrationEnabled && regStatus.loading ? (
        "Verificando cadastro"
      ) : registrationEnabled && !regStatus.ready ? (
        "Revisar pendências"
      ) : (
        confirmLabel
      )}
    </>
  );

  if (inRegistration) {
    return (
      <Modal onClose={onClose} maxWidth="max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <button type="button" onClick={() => setStep("sale")} className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
              <ArrowLeft className="h-3.5 w-3.5" /> Voltar
            </button>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Cadastro do cliente</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Dados e documentos que {adminName ? `a ${adminName}` : "a administradora"} pede para cadastrar a cota. Você pode fechar e continuar depois: tudo fica salvo.
            </p>
          </div>

          <RegistrationForm
            dealId={registrationDealId!}
            administratorId={administratorId}
            showErrors={showErrors}
            onStatus={setRegStatus}
            registerApi={(api) => {
              regApi.current = api;
            }}
          />

          {submitError && <p className="text-sm text-red-600">{submitError}</p>}

          <div className="sticky bottom-0 -mx-5 -mb-5 border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex min-h-11 items-center gap-2.5 border-b border-neutral-100 px-5 py-2.5 dark:border-neutral-800/80">
              {regStatus.loading ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-neutral-400" strokeWidth={2} />
              ) : regStatus.ready ? (
                <CircleCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" strokeWidth={2} />
              ) : (
                <CircleAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" strokeWidth={2} />
              )}
              <p className={`min-w-0 text-sm font-medium ${regStatus.loading ? "text-neutral-500 dark:text-neutral-400" : regStatus.ready ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
                {regStatus.loading ? "Verificando o cadastro…" : regStatus.ready ? "Cadastro completo" : regStatus.summary || "Preencha os itens pendentes para concluir o ganho."}
              </p>
            </div>
            <div className="flex flex-col-reverse gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" onClick={handleFinishLater} disabled={savingDraft || loading} className="btn-secondary w-full sm:w-auto">
                {savingDraft ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando rascunho</> : "Terminar cadastro depois"}
              </button>
              <button type="submit" disabled={loading || regStatus.loading} className={`${confirmClassName} w-full justify-center sm:w-auto`}>
                {!loading && regStatus.ready && <Check className="h-4 w-4" strokeWidth={2.5} />}
                {submitLabel}
              </button>
            </div>
          </div>
        </form>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1">
          <label className="field-label">Data</label>
          <DatePicker value={closedAt} onChange={setClosedAt} max={maxDate} />
        </div>

        {needsAdministrator && (
          <div className="space-y-1">
            <label className="field-label">Administradora</label>
            <Select
              value={administratorId}
              onChange={setAdministratorId}
              options={administrators.map((a) => ({ value: a.id, label: a.name }))}
              placeholder="Escolha a administradora"
              ariaLabel="Administradora"
            />
          </div>
        )}

        {needsCreditType && (
          <div className="space-y-1">
            <label className="field-label">Categoria</label>
            <Select
              value={creditType}
              onChange={setCreditType}
              options={creditTypes.map((c) => ({ value: c, label: c }))}
              placeholder="Escolha a categoria"
              ariaLabel="Categoria"
            />
          </div>
        )}

        {shownPreview && shownPreview.status !== "inactive" && (
          <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100">
            {shownPreview.status === "ok" ? (
              <>
                <p>
                  Comissão{shownPreview.isMe ? "" : ` de ${shownPreview.sellerName}`}:{" "}
                  <strong className="text-base font-semibold">{formatCurrency(shownPreview.total)}</strong>
                  {shownPreview.count === 1
                    ? ` em ${formatMonthLong(shownPreview.firstMonth, { withYear: false }).toLowerCase()}`
                    : ` em ${shownPreview.count}x`}
                  {shownPreview.paidByAdministrator ? " · paga pela administradora" : ""}
                </p>
              </>
            ) : (
              <p>Comissão a confirmar pelo Financeiro.</p>
            )}
          </div>
        )}

        {registrationEnabled && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Próximo passo: dados e documentos do cliente.</p>
        )}

        {submitError && <p className="text-sm text-red-600">{submitError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading || !closedAt || !ready || !administratorsReady || (needsAdministrator && !administratorId) || (needsCreditType && !creditType)}
            className={confirmClassName}
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
