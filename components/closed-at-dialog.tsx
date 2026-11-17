"use client";

import { useState, useEffect, useRef } from "react";
import { ArrowLeft, Check, CircleAlert, CircleCheck, FileX2, Loader2 } from "lucide-react";
import { Modal } from "./modal";
import { LoadingDots } from "./loading-dots";
import { DatePicker } from "./date-picker";
import { Select } from "./select";
import { brazilDateKey } from "@/lib/timezone";
import { getServerTodayKey } from "@/app/actions/date-actions";
import { formatCurrency } from "@/lib/format";
import { formatMonthLong } from "@/lib/commissions/engine";
import { RegistrationForm, type RegistrationApi, type RegistrationStatus } from "@/components/deal-registration/registration-form";
import { TablesLookupPanel } from "@/components/proposals/tables-lookup-dialog";
import type { AdheredQuota } from "@/lib/proposals/quotas";

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
  /**
   * Consulta às tabelas da Servopa — o MESMO painel da proposta
   * (components/proposals/tables-lookup-dialog). Ele troca o conteúdo desta
   * janela, não abre outra; os créditos anexados ficam aqui para a pessoa
   * poder voltar, ajustar e usar.
   */
  const [tablesOpen, setTablesOpen] = useState(false);
  const [quotas, setQuotas] = useState<AdheredQuota[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Cadastro completo: o primeiro clique "arma" o botão (vira "Marcar como ganho") em vez de já efetivar —
  // dar o Ganho é a parte que não volta atrás, merece um clique a mais de certeza. Editar algo que muda o
  // que falta desarma de novo (ex.: apagou um campo obrigatório e corrigiu).
  const [armed, setArmed] = useState(false);
  const [armedResetKey, setArmedResetKey] = useState(`${regStatus.done}:${regStatus.total}`);
  const resetKey = `${regStatus.done}:${regStatus.total}`;
  if (armedResetKey !== resetKey) {
    setArmedResetKey(resetKey);
    if (armed) setArmed(false);
  }
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
    // Várias cotas ou alguma meia: o negócio passa a refletir as cotas — líquido
    // com as meias divididas por 2, bruto com o crédito cheio (sem meia os dois
    // são iguais). O servidor só grava, e só registra na linha do tempo, o que mudou.
    const quotaTotals = registrationEnabled ? regApi.current?.getQuotaTotal() : null;
    if (quotaTotals && quotaTotals.gross > 0 && registrationDealId) {
      try {
        const res = await fetch(`/api/deals/${registrationDealId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: quotaTotals.net, grossValue: quotaTotals.gross }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setSubmitError((data as { error?: string }).error ?? "Não foi possível atualizar o valor do negócio.");
          return;
        }
      } catch {
        setSubmitError("Não foi possível atualizar o valor do negócio.");
        return;
      }
    }
    if (registrationEnabled && !regStatus.ready) {
      // Em vez de um botão travado sem explicação: mostra o que falta e leva até lá.
      setShowErrors(true);
      regApi.current?.focusFirstMissing();
      return;
    }
    if (registrationEnabled && !armed) {
      // 1º clique: só avisa que está pronto para enviar. O Ganho em si pede o 2º clique (confirmLabel).
      setArmed(true);
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

  const [skipping, setSkipping] = useState(false);
  /**
   * Atalho pedido pelo dono (16/11): o consultor não é obrigado a preencher nada
   * para dar o Ganho. Confirma direto, sem exigir campo nenhum do cadastro — o
   * que já tiver sido digitado é salvo como rascunho, mas nada impede o Ganho.
   */
  async function handleSkipRegistration() {
    if (loading || skipping || savingDraft) return;
    setSkipping(true);
    setSubmitError(null);
    try {
      if (regApi.current) await regApi.current.flush().catch(() => false);
      await onConfirm(closedAt, {
        administratorId: needsAdministrator ? administratorId : null,
        creditType: needsCreditType ? creditType : null,
        skipRegistrationReason: "Ganho sem cadastro: o consultor optou por não preencher agora.",
      });
    } finally {
      setSkipping(false);
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
      ) : registrationEnabled && !armed ? (
        "Enviar para o administrativo"
      ) : (
        confirmLabel
      )}
    </>
  );

  if (inRegistration) {
    return (
      // Mesma mecânica da proposta: com a consulta aberta a janela cresce,
      // encolhe pelo espaço dos cartões de anexo (--lookup-reserve) e mostra
      // o painel no lugar do formulário.
      <Modal
        onClose={onClose}
        maxWidth={
          tablesOpen
            ? "max-w-7xl !h-[calc(100vh_-_1rem_-_var(--lookup-reserve,0px))] [translate:0_calc(var(--lookup-reserve,0px)_*_-0.5)] transition-[height,translate] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] !max-h-[calc(100vh-1rem)] !overflow-hidden"
            : // O painel vira uma coluna flex: o corpo rola (overflow-y-auto), o rodapé
              // NÃO — ele fica fora da área que rola, nunca mais por cima do fim do formulário
              // (sticky dentro da mesma área que rola cobre o que passa por baixo dele o tempo
              // todo, não só perto do fim; já tentado e não resolveu).
              "max-w-2xl !flex !flex-col !overflow-hidden !p-0"
        }
      >
        {tablesOpen && (
          <TablesLookupPanel
            onBack={() => setTablesOpen(false)}
            onClose={onClose}
            quotas={quotas}
            onQuotasChange={setQuotas}
            saveLabel="Concluir"
            saveTitle="Preenche grupo, prazo e valor do crédito das cotas da venda"
            onSaveQuotas={() => {
              regApi.current?.applyServopaQuotas(quotas);
              setTablesOpen(false);
            }}
          />
        )}
        {/* O formulário continua MONTADO atrás (só escondido): assim o
            rascunho, o que já foi digitado e os documentos enviados não se
            perdem ao ir e voltar das tabelas. */}
        <form onSubmit={handleSubmit} className={tablesOpen ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <div>
              <button
                type="button"
                onClick={() => {
                  setStep("sale");
                  setArmed(false);
                }}
                className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              >
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
              onOpenTables={() => setTablesOpen(true)}
              onStatus={setRegStatus}
              registerApi={(api) => {
                regApi.current = api;
              }}
            />

            {submitError && <p className="text-sm text-red-600">{submitError}</p>}
          </div>

          <div className="shrink-0 border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            {/* Faixa colorida pelo estado — a cor já diz "ok"/"falta algo" antes mesmo de ler o texto. */}
            <div
              className={`flex min-h-10 items-center gap-2 px-5 py-2 text-sm font-medium ${
                regStatus.loading
                  ? "bg-neutral-50 text-neutral-500 dark:bg-neutral-800/50 dark:text-neutral-400"
                  : regStatus.ready
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                    : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
              }`}
            >
              {regStatus.loading ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={2} />
              ) : regStatus.ready ? (
                <CircleCheck className="h-4 w-4 shrink-0" strokeWidth={2} />
              ) : (
                <CircleAlert className="h-4 w-4 shrink-0" strokeWidth={2} />
              )}
              <p className="min-w-0 truncate">
                {regStatus.loading
                  ? "Verificando o cadastro…"
                  : !regStatus.ready
                    ? regStatus.summary || "Preencha os itens pendentes para concluir o ganho."
                    : armed
                      ? "Confirme para dar o ganho e avisar o administrativo."
                      : "Cadastro completo"}
              </p>
            </div>

            <div className="flex flex-col gap-3 px-5 pt-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <button
                  type="button"
                  onClick={handleFinishLater}
                  disabled={savingDraft || loading || skipping}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 transition hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-400 dark:hover:text-neutral-100"
                >
                  {savingDraft && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {savingDraft ? "Salvando rascunho…" : "Terminar cadastro depois"}
                </button>
                {regStatus.canBypass && (
                  <button
                    type="button"
                    onClick={() => void handleSkipRegistration()}
                    disabled={loading || skipping || savingDraft}
                    title="Dá o ganho sem exigir nenhum dado ou documento do cadastro"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 transition hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-400 dark:hover:text-amber-300"
                  >
                    {skipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileX2 className="h-3.5 w-3.5" />}
                    {skipping ? "Confirmando…" : "Dar ganho sem documentação"}
                  </button>
                )}
              </div>
              <button type="submit" disabled={loading || skipping || regStatus.loading} className={`${confirmClassName} w-full justify-center sm:w-auto`}>
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
