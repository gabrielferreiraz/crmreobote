"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCheck, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { Modal } from "@/components/modal";
import { LoadingDots } from "@/components/loading-dots";
import { DualRangeSlider } from "@/components/dual-range-slider";
import { RmktWavesFields } from "@/components/rmkt-waves-fields";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useRmktWaves } from "@/lib/use-rmkt-waves";
import { MANY_RECIPIENTS_THRESHOLD } from "@/lib/use-whatsapp-provider";
import { renderTemplate } from "@/lib/campaigns/spintax";

type ScriptOption = { id: string; name: string; steps: { text: string; delayAfterSec: number }[] };

type SendResult = {
  campaignId: string | null;
  queued: number;
  skippedNoPhone: number;
  skippedNoInstance: number;
  skippedDuplicateContact: number;
};
type PreviewPosition = { top: number; left: number; maxHeight: number };
type ScriptPreview = { script: ScriptOption; messages: string[] } & PreviewPosition;

const DEFAULT_DELAY_MIN = 80;
const DEFAULT_DELAY_MAX = 1220;
const SLIDER_MIN_MINUTES = 1;
const SLIDER_MAX_MINUTES = 33;
const PREVIEW_VARIABLES = { nome: "Maria Silva", cargo: "Advogada", empresa: "Empresa Exemplo", cidade: "Campo Grande" };

function toMinutesLabel(sec: number): string {
  return `${Math.round(sec / 60)} min`;
}

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
 * Diálogo (não popover — tem campo demais pro padrão BulkActionPopover já
 * usado nas outras ações em massa de deals-list.tsx) de "Enviar mensagem em
 * massa": escolhe um script privado (só os que o próprio usuário criou),
 * ajusta opcionalmente o delay entre contatos, e dispara — vira uma Campaign
 * de verdade (PIPELINE_BULK), processada pelo motor de campanhas de sempre.
 */
export function BulkSendMessageDialog({
  dealIds,
  onClose,
  onSent,
  onCreateScript,
}: {
  dealIds: string[];
  onClose: () => void;
  onSent: () => void;
  /** Chamado ao clicar em "+ Criar script" — quem chama salva o estado (filtros/seleção) antes de navegar. */
  onCreateScript: () => void;
}) {
  const [scripts, setScripts] = useState<ScriptOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scriptIds, setScriptIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<ScriptPreview | null>(null);
  const previewScriptId = preview?.script.id;
  const previewCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewOpenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewAnchorRef = useRef<HTMLElement | null>(null);
  const rmkt = useRmktWaves();
  const [useCustomDelay, setUseCustomDelay] = useState(true);
  const [delayMinSec, setDelayMinSec] = useState(DEFAULT_DELAY_MIN);
  const [delayMaxSec, setDelayMaxSec] = useState(DEFAULT_DELAY_MAX);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  // Não usa useMyWhatsappProvider aqui de propósito: nesse envio, cada
  // negócio manda pelo WhatsApp do PRÓPRIO dono, não de quem está disparando
  // (ver CampaignRecipient.instanceId no schema) — um Gerente/Supervisor/
  // Dono pode ter o próprio número na Meta (sem risco) enquanto um dos
  // donos dos negócios selecionados ainda usa Evolution (risco de verdade).
  // check-provider já resolve isso por negócio, com a mesma preferência
  // Meta > Evolution do envio de verdade.
  const [hasEvolutionInstance, setHasEvolutionInstance] = useState(false);
  const [confirmingBulkSend, setConfirmingBulkSend] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/message-scripts?mine=true");
        if (!res.ok) throw new Error();
        const data: ScriptOption[] = await res.json();
        if (!cancelled) setScripts(data);
      } catch {
        if (!cancelled) setLoadError("Não foi possível carregar seus scripts.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/deals/bulk-send-message/check-provider", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealIds }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { hasEvolutionInstance?: boolean } | null) => {
        if (!cancelled) setHasEvolutionInstance(data?.hasEvolutionInstance ?? false);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function toggleCustomDelay(checked: boolean) {
    setUseCustomDelay(checked);
    if (checked) {
      setDelayMinSec(DEFAULT_DELAY_MIN);
      setDelayMaxSec(DEFAULT_DELAY_MAX);
    }
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

  const canSend = scriptIds.length > 0 && rmkt.valid;
  const needsBulkSendConfirmation = hasEvolutionInstance && dealIds.length >= MANY_RECIPIENTS_THRESHOLD;

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

    const res = await fetch("/api/deals/bulk-send-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dealIds,
        scriptIds,
        ...rmkt.serialize(),
        ...(useCustomDelay ? { delayMinSec, delayMaxSec } : {}),
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
    const skippedParts = [
      result.skippedNoPhone > 0 ? `${result.skippedNoPhone} sem WhatsApp/celular cadastrado` : null,
      result.skippedNoInstance > 0 ? `${result.skippedNoInstance} responsável sem WhatsApp conectado` : null,
      result.skippedDuplicateContact > 0 ? `${result.skippedDuplicateContact} contato repetido na seleção` : null,
    ].filter((p): p is string => !!p);

    return (
      <Modal onClose={onClose}>
        <div className="flex gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-500/15">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Envio agendado</h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {result.queued} mensagem{result.queued === 1 ? "" : "s"} agendada{result.queued === 1 ? "" : "s"}, disparando aos
              poucos (não é instantâneo — mesma proteção anti-bloqueio de qualquer campanha).
              {skippedParts.length > 0 && (
                <>
                  {" "}
                  Ignorados: {skippedParts.join("; ")}.
                </>
              )}
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
      <h2 className="mb-1 text-xl font-semibold text-neutral-900 dark:text-neutral-100">Enviar mensagens</h2>
      <p className="mb-5 text-base text-neutral-500 dark:text-neutral-400">
        {dealIds.length} negócio{dealIds.length === 1 ? "" : "s"} selecionado{dealIds.length === 1 ? "" : "s"}
      </p>

      <div className="space-y-6">
        {loadError ? (
          <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
        ) : scripts === null ? (
          <p className="flex items-center gap-2 text-sm text-neutral-400 dark:text-neutral-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
            Carregando...
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Seu script</h3>
              <button type="button" onClick={onCreateScript} className="text-sm font-semibold text-brand hover:text-brand-hover">
                + Criar script
              </button>
            </div>
            {scripts.length === 0 ? (
              <div className="border border-dashed border-neutral-300 px-4 py-5 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                Nenhum script criado.
              </div>
            ) : (
              <div className="scrollbar-thin max-h-48 space-y-1.5 overflow-y-auto border border-neutral-200 p-2 dark:border-neutral-800">
                {scripts.map((s) => (
                  <label
                    key={s.id}
                    onMouseEnter={(e) => showPreview(s, e.currentTarget)}
                    onMouseLeave={hidePreviewSoon}
                    className="block cursor-pointer rounded-md px-3 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={scriptIds.includes(s.id)}
                        onChange={() => toggleScript(s.id)}
                        className="accent-neutral-900 dark:accent-white"
                      />
                      <span className="min-w-0 truncate text-base font-medium text-neutral-900 dark:text-neutral-100">{s.name}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-400">
          QR Code: disparos em massa podem bloquear o WhatsApp. A API oficial da Meta é mais segura.
        </p>

        {/* Paridade com SendLeadsDialog (Clientes) — pedido explícito. Só
            porque esses destinatários já são negócio não significa que RMKT
            não faz sentido: um contato pode ainda não ter respondido a
            ESTA mensagem específica, mesmo já tendo negócio aberto de
            antes (ver lib/campaigns/engine.ts pro porquê isso já
            funciona). */}
        <RmktWavesFields rmkt={rmkt} scripts={scripts ?? []} dealsContext />

        <div className="space-y-3 border-t border-neutral-100 pt-5 dark:border-neutral-800">
          <label className="flex items-center gap-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            <input
              type="checkbox"
              checked={useCustomDelay}
              onChange={(e) => toggleCustomDelay(e.target.checked)}
              className="accent-neutral-900 dark:accent-white"
            />
            Tempo de envio entre contatos
          </label>

          {useCustomDelay ? (
            <div className="pl-6">
              <DualRangeSlider
                min={SLIDER_MIN_MINUTES}
                max={SLIDER_MAX_MINUTES}
                value={[Math.min(Math.round(delayMinSec / 60), SLIDER_MAX_MINUTES), Math.min(Math.round(delayMaxSec / 60), SLIDER_MAX_MINUTES)]}
                onChange={([newMinMinutes, newMaxMinutes]) => {
                  setDelayMinSec(newMinMinutes * 60);
                  setDelayMaxSec(newMaxMinutes * 60);
                }}
              />
              <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
                <span className="shrink-0">De</span>
                <input
                  type="number"
                  min={SLIDER_MIN_MINUTES}
                  max={SLIDER_MAX_MINUTES}
                  value={Math.round(delayMinSec / 60)}
                  onInput={(e) => {
                    e.currentTarget.value = e.currentTarget.value.replace(/^0+(?=\d)/, "");
                  }}
                  onChange={(e) => setDelayMinSec(Number(e.target.value) * 60)}
                  className="field-input w-20 shrink-0 px-2 py-1 text-center"
                />
                <span className="shrink-0">a</span>
                <input
                  type="number"
                  min={SLIDER_MIN_MINUTES}
                  max={SLIDER_MAX_MINUTES}
                  value={Math.round(delayMaxSec / 60)}
                  onInput={(e) => {
                    e.currentTarget.value = e.currentTarget.value.replace(/^0+(?=\d)/, "");
                  }}
                  onChange={(e) => setDelayMaxSec(Number(e.target.value) * 60)}
                  className="field-input w-20 shrink-0 px-2 py-1 text-center"
                />
                <span className="shrink-0">minutos</span>
              </div>
              <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                {toMinutesLabel(delayMinSec)} a {toMinutesLabel(delayMaxSec)}
              </p>
            </div>
          ) : (
            <p className="pl-6 text-sm text-neutral-400 dark:text-neutral-500">Padrão: {toMinutesLabel(DEFAULT_DELAY_MIN)} a {toMinutesLabel(DEFAULT_DELAY_MAX)}</p>
          )}
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !canSend || (useCustomDelay && delayMaxSec < delayMinSec)}
            className="btn-primary"
          >
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
        description={`Você vai enviar mensagens para ${dealIds.length} negócios usando um número conectado via QR Code (Evolution). Esse tipo de conexão pode ser bloqueado pela Meta em disparos grandes. Deseja continuar?`}
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
