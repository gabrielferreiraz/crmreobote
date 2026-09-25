"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCheck, Loader2, CheckCircle2, RefreshCw, TriangleAlert, Image as ImageIcon } from "lucide-react";
import { Modal } from "@/components/modal";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";
import { BulkCampaignScheduleFields, type BulkCampaignSchedule } from "@/components/bulk-campaign-schedule-fields";
import { BulkScriptPicker, type BulkScriptOption } from "@/components/bulk-script-picker";
import { RmktWavesFields } from "@/components/rmkt-waves-fields";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useRmktWaves } from "@/lib/use-rmkt-waves";
import { useMyWhatsappProvider, MANY_RECIPIENTS_THRESHOLD } from "@/lib/use-whatsapp-provider";
import { renderTemplate } from "@/lib/campaigns/spintax";

type ScriptOption = BulkScriptOption;
type PipelineOption = { id: string; name: string; stages: { id: string; name: string; order: number }[] };

type SendResult = { campaignId: string | null; queued: number; skippedNoPhone: number };
type PreviewPosition = { top: number; left: number; maxHeight: number };
type ScriptPreview = { script: ScriptOption; messages: string[] } & PreviewPosition;

const DEFAULT_DELAY_MIN = 120;
const DEFAULT_DELAY_MAX = 1200;
const PREVIEW_VARIABLES = { nome: "Maria Silva", cargo: "Advogada", empresa: "Empresa Exemplo", cidade: "Campo Grande" };

function delayLabel(sec: number): string {
  if (sec < 60) return `${sec}s depois`;
  return `${Math.round(sec / 60)} min depois`;
}

function previewMessage(text: string): string {
  return renderTemplate(text, PREVIEW_VARIABLES, "Boa tarde").replace(/\{[^{}]*\}/g, "Maria").replace(/[{}]/g, "");
}

function createPreviewMessages(script: ScriptOption): string[] {
  return script.steps.map((step) => (step.text.trim() ? previewMessage(step.text) : "(mensagem vazia)"));
}

/**
 * "Enviar leads e criar negócios" — bem diferente do "Enviar mensagem em
 * massa" do Pipeline (esse opera em negócios que já existem): aqui o
 * contato ainda não tem negócio nenhum. Manda a prospecção inicial e,
 * opcionalmente, uma sequência de RMKT (ondas em dias configuráveis, cada
 * uma com seu próprio script) — quem não responder até o prazo configurado
 * vira "não respondeu" sem nunca ter virado negócio. Quem responder (na
 * prospecção ou em qualquer onda) gera negócio automaticamente na
 * etapa escolhida aqui, com push pro consultor (ver lib/campaigns/reply.ts).
 */
export function SendLeadsDialog({
  contactIds,
  contactsWithDealHistory,
  onClose,
  onSent,
  onCreateScript,
}: {
  contactIds: string[];
  /** Quantos dos contatos selecionados já têm algum negócio (ver comentário
   * em contacts-table.tsx) — pra avisar que essa tela é pensada pra
   * prospecção de quem AINDA não tem negócio, não pra reenviar prospecção
   * genérica pra quem já está em andamento em algum funil (relato do
   * usuário: "não faz sentido, já tem um negócio"). Só um aviso, não um
   * bloqueio — quem quiser reengajar um contato antigo de propósito ainda
   * pode, só fica ciente antes de mandar. */
  contactsWithDealHistory: number;
  onClose: () => void;
  onSent: () => void;
  /** Chamado ao clicar em "+ Criar script" — quem chama salva o estado (filtros/seleção) antes de navegar. */
  onCreateScript: () => void;
}) {
  const [scripts, setScripts] = useState<ScriptOption[] | null>(null);
  const [pipelines, setPipelines] = useState<PipelineOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scriptIds, setScriptIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<ScriptPreview | null>(null);
  const previewScriptId = preview?.script.id;
  const previewCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewOpenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewAnchorRef = useRef<HTMLElement | null>(null);
  const [pipelineId, setPipelineId] = useState("");
  const [stageId, setStageId] = useState("");
  const rmkt = useRmktWaves({ automaticNoReplyDays: true });
  const [schedule, setSchedule] = useState<BulkCampaignSchedule>({
    delayMinSec: DEFAULT_DELAY_MIN,
    delayMaxSec: DEFAULT_DELAY_MAX,
    dailyCap: "",
    allowedWeekdays: [1, 2, 3, 4, 5],
    windowStartHour: "9",
    windowEndHour: "18",
  });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const { provider } = useMyWhatsappProvider();
  const [confirmingBulkSend, setConfirmingBulkSend] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [scriptsRes, pipelinesRes] = await Promise.all([
          fetch("/api/message-scripts?mine=true"),
          fetch("/api/pipelines"),
        ]);
        if (!scriptsRes.ok || !pipelinesRes.ok) throw new Error();
        const scriptsData: ScriptOption[] = await scriptsRes.json();
        const pipelinesData: PipelineOption[] = await pipelinesRes.json();
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
  }, []);

  const selectedPipeline = pipelines?.find((p) => p.id === pipelineId) ?? null;
  const sortedStages = selectedPipeline?.stages.slice().sort((a, b) => a.order - b.order) ?? [];

  function toggleScript(id: string) {
    setScriptIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  function getPreviewPosition(anchor: HTMLElement): PreviewPosition {
    const gutter = 12;
    const preferredWidth = 360;
    const preferredHeight = 420;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(preferredWidth, Math.max(0, viewportWidth - gutter * 2));
    const maxLeft = Math.max(gutter, viewportWidth - gutter - width);
    const canFitOnRight = rect.right + gutter + width <= viewportWidth - gutter;
    const left = canFitOnRight
      ? rect.right + gutter
      : Math.min(maxLeft, Math.max(gutter, rect.left - gutter - width));
    const availableHeight = Math.max(0, viewportHeight - gutter * 2);
    const height = Math.min(preferredHeight, availableHeight);
    const canFitBelow = rect.top + height <= viewportHeight - gutter;
    const canFitAbove = rect.bottom - height >= gutter;
    const top = canFitBelow ? Math.max(gutter, rect.top) : canFitAbove ? rect.bottom - height : gutter;

    return { top, left, maxHeight: height };
  }

  function showPreview(script: ScriptOption, anchor: HTMLElement) {
    if (previewCloseTimer.current) clearTimeout(previewCloseTimer.current);
    if (previewOpenTimer.current) clearTimeout(previewOpenTimer.current);
    if (previewAnchorRef.current !== anchor) setPreview(null);
    previewAnchorRef.current = anchor;
    previewOpenTimer.current = setTimeout(() => {
      if (previewAnchorRef.current !== anchor) return;
      setPreview({ script, messages: createPreviewMessages(script), ...getPreviewPosition(anchor) });
    }, 250);
  }

  function refreshPreview() {
    setPreview((current) => (current ? { ...current, messages: createPreviewMessages(current.script) } : null));
  }

  function hidePreviewSoon() {
    if (previewCloseTimer.current) clearTimeout(previewCloseTimer.current);
    if (previewOpenTimer.current) clearTimeout(previewOpenTimer.current);
    previewCloseTimer.current = setTimeout(() => setPreview(null), 120);
  }

  useEffect(() => {
    if (!previewScriptId) return;

    const repositionPreview = () => {
      const anchor = previewAnchorRef.current;
      if (!anchor || !document.documentElement.contains(anchor)) {
        setPreview(null);
        return;
      }
      setPreview((current) => (current ? { ...current, ...getPreviewPosition(anchor) } : null));
    };

    window.addEventListener("resize", repositionPreview);
    window.addEventListener("scroll", repositionPreview, true);
    return () => {
      window.removeEventListener("resize", repositionPreview);
      window.removeEventListener("scroll", repositionPreview, true);
    };
  }, [previewScriptId]);

  useEffect(() => {
    return () => {
      if (previewCloseTimer.current) clearTimeout(previewCloseTimer.current);
      if (previewOpenTimer.current) clearTimeout(previewOpenTimer.current);
    };
  }, []);

  const canSend = scriptIds.length > 0 && !!pipelineId && !!stageId && rmkt.valid;
  // Só interrompe o fluxo com uma confirmação a mais quando as DUAS
  // condições valem: número Evolution (risco real de banimento — número
  // oficial da Meta não tem esse risco) E disparo grande o bastante pra
  // justificar (ver MANY_RECIPIENTS_THRESHOLD).
  const needsBulkSendConfirmation = provider === "EVOLUTION" && contactIds.length >= MANY_RECIPIENTS_THRESHOLD;

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
    setError(null);

    const res = await fetch("/api/contacts/bulk-send-leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactIds,
        scriptIds,
        targetPipelineId: pipelineId,
        targetStageId: stageId,
        ...rmkt.serialize(),
        delayMinSec: schedule.delayMinSec,
        delayMaxSec: schedule.delayMaxSec,
        dailyCap: schedule.dailyCap === "" ? null : Number(schedule.dailyCap),
        allowedWeekdays: schedule.allowedWeekdays,
        windowStartHour: schedule.windowStartHour === "" ? Number.NaN : Number(schedule.windowStartHour),
        windowEndHour: schedule.windowEndHour === "" ? Number.NaN : Number(schedule.windowEndHour),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSending(false);

    if (!res.ok) {
      setError(data.error ?? "Erro ao enviar");
      return;
    }

    setResult(data);
    onSent();
  }

  if (result) {
    return (
      <Modal onClose={onClose}>
        <div className="flex gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-500/15">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Prospecção agendada</h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {result.queued} lead{result.queued === 1 ? "" : "s"} entrando na prospecção, disparando aos poucos (mesma
              proteção anti-bloqueio de qualquer campanha). Quem responder vira negócio automaticamente, com aviso pra
              você.
              {result.skippedNoPhone > 0 && ` Ignorados: ${result.skippedNoPhone} sem WhatsApp/celular cadastrado.`}
            </p>
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

  return (
    <>
      <Modal onClose={onClose} maxWidth="max-w-lg">
        <h2 className="mb-1 text-xl font-semibold text-neutral-900 dark:text-neutral-100">Enviar leads</h2>
        <p className="mb-5 text-base text-neutral-500 dark:text-neutral-400">{contactIds.length} contato{contactIds.length === 1 ? "" : "s"} selecionado{contactIds.length === 1 ? "" : "s"}</p>

        {/* Pedido explícito: avisar quando a seleção inclui contato que já tem
          negócio — esta tela é pensada pra prospecção de lead novo (ver
          doc-comment do componente), mandar de novo pra quem já está em
          andamento em algum funil normalmente não faz sentido. Só aviso,
          não bloqueio — o negócio em si não duplica de qualquer forma
          (handleCampaignReply só cria se o contato ainda não tiver um
          aberto), então quem seguir mesmo assim não corre risco de
          duplicata, só de mandar uma mensagem de prospecção fora de hora. */}
        {contactsWithDealHistory > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-500/30 dark:bg-amber-500/10">
            <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" strokeWidth={2} />
            <p className="text-amber-700 dark:text-amber-400">
              {contactsWithDealHistory === contactIds.length
                ? contactsWithDealHistory === 1
                  ? "O contato selecionado já tem negócio registrado."
                  : "Todos os contatos selecionados já têm negócio registrado."
                : `${contactsWithDealHistory} de ${contactIds.length} contatos já têm negócio registrado.`}
            </p>
          </div>
        )}

        {loadError ? (
          <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
        ) : scripts === null || pipelines === null ? (
          <p className="flex items-center gap-2 text-sm text-neutral-400 dark:text-neutral-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
            Carregando...
          </p>
        ) : (
          <div className="space-y-6">
            <BulkScriptPicker
              scripts={scripts}
              selectedIds={scriptIds}
              onToggle={toggleScript}
              onCreateScript={onCreateScript}
              onPreview={showPreview}
              onPreviewEnd={hidePreviewSoon}
            />

            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-400">
              QR Code: disparos em massa podem BLOQUEAR o WhatsApp. A API oficial da Meta é mais segura.
            </p>

            <div className="grid grid-cols-2 gap-3 border-t border-neutral-100 pt-5 dark:border-neutral-800">
              <div className="space-y-1">
                <label className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">Destino</label>
                <Select
                  value={pipelineId}
                  onChange={(v) => {
                    setPipelineId(v);
                    const p = pipelines.find((pl) => pl.id === v);
                    const firstStage = p?.stages.slice().sort((a, b) => a.order - b.order)[0];
                    setStageId(firstStage?.id ?? "");
                  }}
                  className="w-full py-1.5 text-sm"
                  options={pipelines.map((p) => ({ value: p.id, label: p.name }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">Etapa</label>
                <Select
                  value={stageId}
                  onChange={setStageId}
                  className="w-full py-1.5 text-sm"
                  options={sortedStages.map((s) => ({ value: s.id, label: s.name }))}
                />
              </div>
            </div>

            <RmktWavesFields rmkt={rmkt} scripts={scripts} showNoReplyDays={false} />

            <BulkCampaignScheduleFields value={schedule} onChange={setSchedule} />

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="btn-ghost">
                Cancelar
              </button>
              <button type="button" onClick={handleSend} disabled={sending || !canSend || schedule.delayMaxSec < schedule.delayMinSec || schedule.allowedWeekdays.length === 0} className="btn-primary">
                {sending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
                {sending ? (
                  <span className="inline-flex items-center gap-1">
                    Enviando
                    <LoadingDots />
                  </span>
                ) : (
                  "Enviar"
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>
      {preview &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            onMouseEnter={() => {
              if (previewCloseTimer.current) clearTimeout(previewCloseTimer.current);
              if (previewOpenTimer.current) clearTimeout(previewOpenTimer.current);
            }}
            onMouseLeave={hidePreviewSoon}
            className="animate-pop-in scrollbar-thin fixed z-[70] max-h-[420px] w-[360px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg border border-neutral-200 bg-[#efeae2] shadow-xl motion-reduce:animate-none dark:border-neutral-700 dark:bg-[#0b141a]"
            style={{ top: preview.top, left: preview.left, maxHeight: preview.maxHeight }}
          >
            <div className="flex items-center justify-between gap-3 bg-[#075e54] px-3 py-2.5 text-white dark:bg-[#202c33]">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 text-xs font-semibold">M</div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">Maria Silva</p>
                  <p className="text-[11px] text-white/70">Prévia de envio</p>
                </div>
              </div>
              <button
                type="button"
                onClick={refreshPreview}
                title="Gerar outra prévia"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 text-[11px] font-semibold transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              >
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
                Mudar prévia
              </button>
            </div>
            <div className="space-y-2.5 p-3">
              {preview.script.steps.map((step, index) => (
                <div key={index}>
                  {index > 0 && (
                    <p className="mb-2 text-center text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                      {delayLabel(preview.script.steps[index - 1].delayAfterSec)}
                    </p>
                  )}
                  <div className="ml-auto max-w-[88%] rounded-lg rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-sm leading-snug whitespace-pre-wrap text-neutral-800 shadow-sm dark:bg-[#005c4b] dark:text-neutral-100">
                    {step.type === "IMAGE" && (
                      <span className="mb-1.5 flex h-20 items-center justify-center rounded-md bg-black/10 text-[11px] text-neutral-600 dark:bg-white/10 dark:text-neutral-200">
                        <ImageIcon className="mr-1.5 h-3.5 w-3.5" strokeWidth={2} /> Imagem
                      </span>
                    )}
                    <p>{preview.messages[index]}</p>
                    <span className="mt-1 flex items-center justify-end gap-1 text-[10px] text-neutral-500 dark:text-neutral-300">
                      agora <CheckCheck className="h-3.5 w-3.5 text-sky-500 dark:text-sky-300" strokeWidth={2} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
      {confirmingBulkSend && (
        <ConfirmDialog
          title="Risco de banimento no WhatsApp"
          description={`Você vai enviar mensagens para ${contactIds.length} contatos usando um número conectado via QR Code (Evolution). Esse tipo de conexão pode ser bloqueado pela Meta em disparos grandes. Deseja continuar?`}
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
