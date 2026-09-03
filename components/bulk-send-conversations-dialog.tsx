"use client";

import { useEffect, useState } from "react";
import { Loader2, MessageCircleMore, CheckCircle2, AlertTriangle } from "lucide-react";
import { Modal } from "@/components/modal";
import { LoadingDots } from "@/components/loading-dots";
import { EmptyState } from "@/components/empty-state";
import { Select } from "@/components/select";
import { DualRangeSlider } from "@/components/dual-range-slider";
import { RmktWavesFields } from "@/components/rmkt-waves-fields";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useRmktWaves } from "@/lib/use-rmkt-waves";
import { useMyWhatsappProvider, MANY_RECIPIENTS_THRESHOLD } from "@/lib/use-whatsapp-provider";

type ScriptOption = { id: string; name: string; steps: { text: string; delayAfterSec: number }[] };
type PipelineOption = { id: string; name: string; stages: { id: string; name: string; order: number }[] };

type Recipient = {
  contactId: string;
  /** null = contato sem negócio aberto → vai pro bulk-send-leads (cria negócio). */
  dealId: string | null;
};

type PartialResult = { queued: number; skippedNoPhone: number; skippedNoInstance: number };
type SendResult = { leads: PartialResult | null; deals: PartialResult | null; error: string | null };

const DEFAULT_DELAY_MIN = 80;
const DEFAULT_DELAY_MAX = 1220;
const SLIDER_MIN_SEC = 80;
const SLIDER_MAX_SEC = 2000;

function toMinutesLabel(sec: number): string {
  return `${(sec / 60).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} min`;
}

/**
 * Diálogo de disparo em massa a partir da página de Conversas do WhatsApp.
 *
 * A seleção pode ser mista — conversas com e sem negócio aberto. Por isso
 * este componente divide os destinatários internamente e dispara os dois
 * endpoints em paralelo (`Promise.allSettled`), nunca tudo-ou-nada:
 *
 *  - contactIds sem dealId → POST /api/contacts/bulk-send-leads (cria negócio
 *    ao responder, RMKT completo).
 *  - dealIds → POST /api/deals/bulk-send-message (negócio já existe, RMKT
 *    habilitado após a correção de lib/campaigns/engine.ts).
 *
 * O seletor de pipeline/etapa só aparece quando há pelo menos um contato sem
 * negócio — pra quem já tem negócio aberto não faz sentido escolher onde
 * "cair" ao responder (já está num funil).
 *
 * Não reutiliza SendLeadsDialog nem BulkSendMessageDialog de propósito —
 * pra não arriscar alterar o comportamento das duas telas que já funcionam
 * em produção (Clientes e Pipeline). Esta é uma terceira superfície, com
 * lógica de roteamento própria.
 */
export function BulkSendConversationsDialog({
  recipients,
  onClose,
  onSent,
  onCreateScript,
}: {
  recipients: Recipient[];
  onClose: () => void;
  onSent: () => void;
  onCreateScript: () => void;
}) {
  const [scripts, setScripts] = useState<ScriptOption[] | null>(null);
  const [pipelines, setPipelines] = useState<PipelineOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [scriptIds, setScriptIds] = useState<string[]>([]);
  const [pipelineId, setPipelineId] = useState("");
  const [stageId, setStageId] = useState("");
  const rmkt = useRmktWaves();
  const [useCustomDelay, setUseCustomDelay] = useState(false);
  const [delayMinSec, setDelayMinSec] = useState(DEFAULT_DELAY_MIN);
  const [delayMaxSec, setDelayMaxSec] = useState(DEFAULT_DELAY_MAX);

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const { provider } = useMyWhatsappProvider();
  const [confirmingBulkSend, setConfirmingBulkSend] = useState(false);

  // Divide os destinatários já no render — array estável, não muda.
  const dealIds = recipients.filter((r) => r.dealId !== null).map((r) => r.dealId as string);
  const contactIds = recipients.filter((r) => r.dealId === null).map((r) => r.contactId);
  const hasLeads = contactIds.length > 0;
  const hasDeals = dealIds.length > 0;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fetches: Promise<Response>[] = [fetch("/api/message-scripts?mine=true")];
        if (hasLeads) fetches.push(fetch("/api/pipelines"));

        const results = await Promise.all(fetches);
        if (results.some((r) => !r.ok)) throw new Error();

        const scriptsData: ScriptOption[] = await results[0].json();
        const pipelinesData: PipelineOption[] = hasLeads ? await results[1].json() : [];

        if (cancelled) return;
        setScripts(scriptsData);
        setPipelines(pipelinesData);
        if (pipelinesData.length > 0) {
          setPipelineId(pipelinesData[0].id);
          const firstStage = pipelinesData[0].stages.slice().sort((a, b) => a.order - b.order)[0];
          if (firstStage) setStageId(firstStage.id);
        }
      } catch {
        if (!cancelled) setLoadError("Não foi possível carregar os dados do formulário.");
      }
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedPipeline = pipelines?.find((p) => p.id === pipelineId) ?? null;
  const sortedStages = selectedPipeline?.stages.slice().sort((a, b) => a.order - b.order) ?? [];

  function toggleScript(id: string) {
    setScriptIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  const canSend =
    scriptIds.length > 0 &&
    rmkt.valid &&
    (!hasLeads || (!!pipelineId && !!stageId));
  // Ver comentário equivalente em send-leads-dialog.tsx.
  const needsBulkSendConfirmation = provider === "EVOLUTION" && recipients.length >= MANY_RECIPIENTS_THRESHOLD;

  function handleSend() {
    if (!canSend) return;
    if (needsBulkSendConfirmation) {
      setConfirmingBulkSend(true);
      return;
    }
    doSend();
  }

  async function doSend() {
    setSending(true);

    const rmktPayload = rmkt.serialize();
    const delayPayload = useCustomDelay ? { delayMinSec, delayMaxSec } : {};

    const calls: Promise<{ kind: "leads" | "deals"; data: PartialResult } | { kind: "error"; tag: "leads" | "deals"; msg: string }>[] = [];

    if (hasLeads) {
      calls.push(
        fetch("/api/contacts/bulk-send-leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contactIds,
            scriptIds,
            targetPipelineId: pipelineId,
            targetStageId: stageId,
            ...rmktPayload,
            ...delayPayload,
          }),
        }).then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok) return { kind: "error" as const, tag: "leads" as const, msg: data.error ?? "Erro ao enviar para contatos sem negócio" };
          return { kind: "leads" as const, data: data as PartialResult };
        }),
      );
    }

    if (hasDeals) {
      calls.push(
        fetch("/api/deals/bulk-send-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dealIds,
            scriptIds,
            ...rmktPayload,
            ...delayPayload,
          }),
        }).then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok) return { kind: "error" as const, tag: "deals" as const, msg: data.error ?? "Erro ao enviar para negócios ativos" };
          return { kind: "deals" as const, data: data as PartialResult };
        }),
      );
    }

    const settled = await Promise.allSettled(calls);
    setSending(false);

    let leadsResult: PartialResult | null = null;
    let dealsResult: PartialResult | null = null;
    const errors: string[] = [];

    for (const s of settled) {
      if (s.status === "rejected") {
        errors.push("Falha de conexão ao enviar.");
        continue;
      }
      const val = s.value;
      if (val.kind === "error") {
        errors.push(val.msg);
      } else if (val.kind === "leads") {
        leadsResult = val.data;
      } else {
        dealsResult = val.data;
      }
    }

    if (leadsResult || dealsResult) onSent();

    setResult({
      leads: leadsResult,
      deals: dealsResult,
      error: errors.length > 0 ? errors.join(" ") : null,
    });
  }

  // ── Tela de resultado ────────────────────────────────────────────────────────
  if (result) {
    const totalQueued = (result.leads?.queued ?? 0) + (result.deals?.queued ?? 0);
    const totalSkipped = (result.leads?.skippedNoPhone ?? 0) + (result.deals?.skippedNoPhone ?? 0) + (result.deals?.skippedNoInstance ?? 0);

    return (
      <Modal onClose={onClose}>
        <div className="flex gap-3">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${result.error && !result.leads && !result.deals ? "bg-red-50 dark:bg-red-500/15" : "bg-emerald-50 dark:bg-emerald-500/15"}`}
          >
            {result.error && !result.leads && !result.deals ? (
              <AlertTriangle className="h-4 w-4 text-red-500 dark:text-red-400" strokeWidth={2} />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" strokeWidth={2} />
            )}
          </div>
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {result.error && !result.leads && !result.deals ? "Erro no envio" : "Campanha agendada"}
            </h2>
            {(result.leads || result.deals) && (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                {totalQueued} mensagem{totalQueued === 1 ? "" : "s"} agendada{totalQueued === 1 ? "" : "s"}, disparando aos
                poucos com delay anti-bloqueio.
                {totalSkipped > 0 && ` ${totalSkipped} ignorado${totalSkipped === 1 ? "" : "s"} (sem número ou instância).`}
              </p>
            )}
            {result.leads && (
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                Contatos sem negócio: quem responder terá negócio criado automaticamente.
              </p>
            )}
            {result.error && (
              <p className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
                {result.error}
              </p>
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="btn-primary">
            Fechar
          </button>
        </div>
      </Modal>
    );
  }

  // ── Formulário ───────────────────────────────────────────────────────────────
  return (
    <>
    <Modal onClose={onClose} maxWidth="max-w-lg">
      <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Enviar em massa</h2>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
        {recipients.length} conversa{recipients.length === 1 ? "" : "s"} selecionada{recipients.length === 1 ? "" : "s"}
        {hasDeals && hasLeads
          ? ` — ${dealIds.length} com negócio ativo, ${contactIds.length} sem.`
          : hasDeals
            ? " · todas com negócio ativo."
            : " · nenhuma tem negócio ainda."}
      </p>

      {loadError ? (
        <EmptyState icon={AlertTriangle} title="Erro ao carregar" description={loadError} />
      ) : scripts === null ? (
        <div className="flex items-center justify-center py-12">
          <LoadingDots />
        </div>
      ) : scripts.length === 0 ? (
        <EmptyState
          icon={MessageCircleMore}
          title="Nenhum script criado"
          description="Crie um script de mensagem antes de disparar uma campanha."
          action={
            <button onClick={onCreateScript} className="btn-secondary">
              + Criar script
            </button>
          }
        />
      ) : (
        <div className="space-y-4">
          {/* Scripts */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Mensagem
                <span className="ml-1 text-xs font-normal text-neutral-400">(selecione um ou mais para A/B)</span>
              </label>
              <button type="button" onClick={onCreateScript} className="text-xs text-brand hover:underline">
                + Criar script
              </button>
            </div>
            <div className="max-h-36 space-y-1 overflow-y-auto">
              {scripts.map((s) => (
                <label
                  key={s.id}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    scriptIds.includes(s.id)
                      ? "border-brand/40 bg-brand-light dark:border-brand/30 dark:bg-brand/10"
                      : "border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:border-neutral-700 dark:hover:bg-neutral-900"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={scriptIds.includes(s.id)}
                    onChange={() => toggleScript(s.id)}
                    className="mt-0.5 accent-neutral-900 dark:accent-white"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-neutral-800 dark:text-neutral-200">{s.name}</p>
                    {s.steps[0] && (
                      <p className="truncate text-xs text-neutral-400 dark:text-neutral-500">{s.steps[0].text}</p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Pipeline/Etapa — só aparece se há contatos SEM negócio */}
          {hasLeads && pipelines && (
            <div className="space-y-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Os {contactIds.length} contato{contactIds.length === 1 ? "" : "s"} sem negócio cairão neste funil quando responderem:
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={pipelineId}
                  onChange={(v) => {
                    setPipelineId(v);
                    const pipeline = pipelines.find((p) => p.id === v);
                    const firstStage = pipeline?.stages.slice().sort((a, b) => a.order - b.order)[0];
                    setStageId(firstStage?.id ?? "");
                  }}
                  className="py-1.5 text-sm"
                  options={pipelines.map((p) => ({ value: p.id, label: p.name }))}
                />
                <Select
                  value={stageId}
                  onChange={setStageId}
                  className="py-1.5 text-sm"
                  options={sortedStages.map((s) => ({ value: s.id, label: s.name }))}
                />
              </div>
            </div>
          )}

          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-400">
            Disparo em massa por número conectado via QR Code (Evolution) tem risco maior de banimento. Número
            conectado pela API oficial da Meta não tem esse risco.
          </p>

          {/* RMKT */}
          <RmktWavesFields rmkt={rmkt} scripts={scripts} />

          {/* Delay */}
          <div className="space-y-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
            <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <input
                type="checkbox"
                checked={useCustomDelay}
                onChange={(e) => setUseCustomDelay(e.target.checked)}
                className="accent-neutral-900 dark:accent-white"
              />
              Personalizar intervalo entre mensagens
            </label>
            {useCustomDelay && (
              <div className="space-y-1 pl-6">
                <DualRangeSlider
                  min={SLIDER_MIN_SEC}
                  max={SLIDER_MAX_SEC}
                  value={[Math.min(delayMinSec, SLIDER_MAX_SEC), Math.min(delayMaxSec, SLIDER_MAX_SEC)]}
                  onChange={([newMin, newMax]) => {
                    setDelayMinSec(newMin);
                    setDelayMaxSec(newMax);
                  }}
                />
                <p className="text-center text-xs text-neutral-400 dark:text-neutral-500">
                  {toMinutesLabel(delayMinSec)} – {toMinutesLabel(delayMaxSec)}
                </p>
              </div>
            )}
          </div>

          {/* Enviar */}
          <div className="flex items-center justify-end gap-3 border-t border-neutral-100 pt-3 dark:border-neutral-800">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !canSend}
              className="btn-primary"
            >
              {sending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Agendando…
                </>
              ) : (
                <>
                  <MessageCircleMore className="h-3.5 w-3.5" />
                  Enviar para {recipients.length}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </Modal>
    {confirmingBulkSend && (
      <ConfirmDialog
        title="Risco de banimento no WhatsApp"
        description={`Você vai enviar mensagens para ${recipients.length} conversas usando um número conectado via QR Code (Evolution). Esse tipo de conexão pode ser bloqueado pela Meta em disparos grandes. Deseja continuar?`}
        confirmLabel="Disparar mesmo assim"
        onClose={() => setConfirmingBulkSend(false)}
        onConfirm={async () => {
          setConfirmingBulkSend(false);
          await doSend();
        }}
      />
    )}
    </>
  );
}
