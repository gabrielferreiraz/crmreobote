"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, MessageCircleMore, CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/modal";
import { LoadingDots } from "@/components/loading-dots";
import { EmptyState } from "@/components/empty-state";
import { DualRangeSlider } from "@/components/dual-range-slider";

type ScriptOption = { id: string; name: string; steps: { text: string; delayAfterSec: number }[] };

type SendResult = {
  campaignId: string | null;
  queued: number;
  skippedNoPhone: number;
  skippedNoInstance: number;
  skippedDuplicateContact: number;
};

const DEFAULT_DELAY_MIN = 50;
const DEFAULT_DELAY_MAX = 120;
// A trilha do slider vai só até 5min — a API aceita até 1h (ver campos numéricos
// abaixo dela, que continuam aceitando até 3600), mas arrastar uma bolinha
// numa trilha de 1h inteira deixaria a faixa útil (dezenas a poucas centenas
// de segundos) espremida em poucos pixels, difícil de acertar.
const SLIDER_MIN_SEC = 10;
const SLIDER_MAX_SEC = 300;

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
  const [scriptId, setScriptId] = useState("");
  const [useCustomDelay, setUseCustomDelay] = useState(false);
  const [delayMinSec, setDelayMinSec] = useState(DEFAULT_DELAY_MIN);
  const [delayMaxSec, setDelayMaxSec] = useState(DEFAULT_DELAY_MAX);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);

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

  function toggleCustomDelay(checked: boolean) {
    setUseCustomDelay(checked);
    if (checked) {
      setDelayMinSec(DEFAULT_DELAY_MIN);
      setDelayMaxSec(DEFAULT_DELAY_MAX);
    }
  }

  async function handleSend() {
    if (!scriptId) return;
    setSending(true);
    setError(null);

    const res = await fetch("/api/deals/bulk-send-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dealIds,
        scriptId,
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
    <Modal onClose={onClose}>
      <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Enviar mensagem em massa</h2>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
        {dealIds.length} negócio{dealIds.length === 1 ? "" : "s"} selecionado{dealIds.length === 1 ? "" : "s"}.
      </p>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="field-label">Script</label>

          {loadError ? (
            <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
          ) : scripts === null ? (
            <p className="flex items-center gap-2 text-sm text-neutral-400 dark:text-neutral-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
              Carregando...
            </p>
          ) : scripts.length === 0 ? (
            <EmptyState
              icon={MessageCircleMore}
              title="Você ainda não criou nenhum script"
              description="Monte um script com sua própria mensagem (e variações) pra usar nos envios em massa."
              action={
                <button type="button" onClick={onCreateScript} className="btn-primary btn-sm">
                  <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                  Criar script
                </button>
              }
            />
          ) : (
            <div className="scrollbar-thin max-h-48 space-y-1.5 overflow-y-auto rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
              {scripts.map((s) => (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-start gap-2.5 rounded-md p-2 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                >
                  <input
                    type="radio"
                    name="script"
                    checked={scriptId === s.id}
                    onChange={() => setScriptId(s.id)}
                    className="mt-0.5 accent-neutral-900 dark:accent-white"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {s.name}
                    </span>
                    <span className="block truncate text-xs text-neutral-400 dark:text-neutral-500">
                      {s.steps[0]?.text || "(vazio)"}
                      {s.steps.length > 1 ? ` · +${s.steps.length - 1} mensagem${s.steps.length - 1 === 1 ? "" : "ns"}` : ""}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {scripts !== null && scripts.length > 0 && (
            <button
              type="button"
              onClick={onCreateScript}
              className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              <Plus className="h-3 w-3" strokeWidth={2.5} />
              Criar script
            </button>
          )}
        </div>

        <div className="space-y-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
            <input
              type="checkbox"
              checked={useCustomDelay}
              onChange={(e) => toggleCustomDelay(e.target.checked)}
              className="accent-neutral-900 dark:accent-white"
            />
            Selecionar delay entre contatos
          </label>

          {useCustomDelay ? (
            <div className="pl-6">
              <DualRangeSlider
                min={SLIDER_MIN_SEC}
                max={SLIDER_MAX_SEC}
                value={[Math.min(delayMinSec, SLIDER_MAX_SEC), Math.min(delayMaxSec, SLIDER_MAX_SEC)]}
                onChange={([newMin, newMax]) => {
                  setDelayMinSec(newMin);
                  setDelayMaxSec(newMax);
                }}
              />
              <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
                De
                <input
                  type="number"
                  min={10}
                  max={3600}
                  value={delayMinSec}
                  onChange={(e) => setDelayMinSec(Number(e.target.value))}
                  className="field-input w-20 px-2 py-1 text-center"
                />
                a
                <input
                  type="number"
                  min={10}
                  max={3600}
                  value={delayMaxSec}
                  onChange={(e) => setDelayMaxSec(Number(e.target.value))}
                  className="field-input w-20 px-2 py-1 text-center"
                />
                segundos
              </div>
            </div>
          ) : (
            <p className="pl-6 text-xs text-neutral-400 dark:text-neutral-500">
              Um tempo aleatório entre {DEFAULT_DELAY_MIN} e {DEFAULT_DELAY_MAX} segundos será usado entre cada
              contato (padrão — ajuda a evitar bloqueios).
            </p>
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
            disabled={sending || !scriptId || (useCustomDelay && delayMaxSec < delayMinSec)}
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
  );
}
