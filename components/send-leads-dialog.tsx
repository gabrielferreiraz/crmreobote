"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, MessageCircleMore, CheckCircle2, X } from "lucide-react";
import { Modal } from "@/components/modal";
import { LoadingDots } from "@/components/loading-dots";
import { EmptyState } from "@/components/empty-state";
import { Select } from "@/components/select";
import { DualRangeSlider } from "@/components/dual-range-slider";

type ScriptOption = { id: string; name: string; steps: { text: string; delayAfterSec: number }[] };
type PipelineOption = { id: string; name: string; stages: { id: string; name: string; order: number }[] };
type WaveRow = { dayOffset: string; scriptId: string };

type SendResult = { campaignId: string | null; queued: number; skippedNoPhone: number };

const DEFAULT_DELAY_MIN = 80;
const DEFAULT_DELAY_MAX = 1220;
const SLIDER_MIN_SEC = 80;
const SLIDER_MAX_SEC = 2000;

function toMinutesLabel(sec: number): string {
  return `${(sec / 60).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} min`;
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
  onClose,
  onSent,
  onCreateScript,
}: {
  contactIds: string[];
  onClose: () => void;
  onSent: () => void;
  /** Chamado ao clicar em "+ Criar script" — quem chama salva o estado (filtros/seleção) antes de navegar. */
  onCreateScript: () => void;
}) {
  const [scripts, setScripts] = useState<ScriptOption[] | null>(null);
  const [pipelines, setPipelines] = useState<PipelineOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scriptId, setScriptId] = useState("");
  const [pipelineId, setPipelineId] = useState("");
  const [stageId, setStageId] = useState("");
  const [rmktEnabled, setRmktEnabled] = useState(false);
  const [waves, setWaves] = useState<WaveRow[]>([{ dayOffset: "3", scriptId: "" }]);
  const [noReplyDays, setNoReplyDays] = useState("3");
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

  function addWave() {
    setWaves((prev) => [...prev, { dayOffset: "", scriptId: "" }]);
  }
  function removeWave(index: number) {
    setWaves((prev) => prev.filter((_, i) => i !== index));
  }
  function updateWave(index: number, patch: Partial<WaveRow>) {
    setWaves((prev) => prev.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  }

  const wavesValid =
    !rmktEnabled ||
    (waves.length > 0 &&
      waves.every((w) => w.dayOffset.trim() && w.scriptId) &&
      waves.every((w, i) => i === 0 || Number(w.dayOffset) > Number(waves[i - 1].dayOffset)) &&
      waves.every((w) => Number(w.dayOffset) < Number(noReplyDays || 0)));

  const canSend =
    !!scriptId && !!pipelineId && !!stageId && !!noReplyDays.trim() && Number(noReplyDays) > 0 && wavesValid;

  async function handleSend() {
    if (!canSend) return;
    setSending(true);
    setError(null);

    const res = await fetch("/api/contacts/bulk-send-leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactIds,
        scriptId,
        targetPipelineId: pipelineId,
        targetStageId: stageId,
        noReplyDays: Number(noReplyDays),
        rmktEnabled,
        rmktWaves: rmktEnabled ? waves.map((w) => ({ dayOffset: Number(w.dayOffset), scriptId: w.scriptId })) : undefined,
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
    <Modal onClose={onClose} maxWidth="max-w-lg">
      <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Enviar leads e criar negócios</h2>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
        {contactIds.length} contato{contactIds.length === 1 ? "" : "s"} selecionado{contactIds.length === 1 ? "" : "s"}. Quem
        responder vira negócio automaticamente; quem não responder no prazo vira &quot;não respondeu&quot;.
      </p>

      {loadError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
      ) : scripts === null || pipelines === null ? (
        <p className="flex items-center gap-2 text-sm text-neutral-400 dark:text-neutral-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
          Carregando...
        </p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="field-label">Script inicial (prospecção)</label>
            {scripts.length === 0 ? (
              <EmptyState
                icon={MessageCircleMore}
                title="Você ainda não criou nenhum script"
                description="Monte um script com sua própria mensagem (e variações) pra usar na prospecção."
                action={
                  <button type="button" onClick={onCreateScript} className="btn-primary btn-sm">
                    <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                    Criar script
                  </button>
                }
              />
            ) : (
              <>
                <div className="scrollbar-thin max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
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
                        <span className="block truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{s.name}</span>
                        <span className="block truncate text-xs text-neutral-400 dark:text-neutral-500">
                          {s.steps[0]?.text || "(vazio)"}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={onCreateScript}
                  className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                >
                  <Plus className="h-3 w-3" strokeWidth={2.5} />
                  Criar script
                </button>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-neutral-100 pt-3 dark:border-neutral-800">
            <div className="space-y-1">
              <label className="field-label">Pipeline de destino</label>
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
              <label className="field-label">Etapa (quando virar negócio)</label>
              <Select
                value={stageId}
                onChange={setStageId}
                className="w-full py-1.5 text-sm"
                options={sortedStages.map((s) => ({ value: s.id, label: s.name }))}
              />
            </div>
          </div>

          <div className="space-y-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
            <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <input
                type="checkbox"
                checked={rmktEnabled}
                onChange={(e) => setRmktEnabled(e.target.checked)}
                className="accent-neutral-900 dark:accent-white"
              />
              Enviar RMKT pra quem não responder a prospecção
            </label>

            {rmktEnabled && (
              <div className="space-y-2 pl-6">
                {waves.map((wave, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">Dia</span>
                    <input
                      type="number"
                      min={1}
                      value={wave.dayOffset}
                      onChange={(e) => updateWave(i, { dayOffset: e.target.value })}
                      className="field-input w-16 shrink-0 px-2 py-1 text-center text-sm"
                    />
                    <Select
                      value={wave.scriptId}
                      onChange={(v) => updateWave(i, { scriptId: v })}
                      className="min-w-0 flex-1 py-1.5 text-sm"
                      options={[
                        { value: "", label: "Selecione o script" },
                        ...scripts.map((s) => ({ value: s.id, label: s.name })),
                      ]}
                    />
                    <button
                      type="button"
                      onClick={() => removeWave(i)}
                      className="icon-btn h-7 w-7 shrink-0"
                      aria-label="Remover onda"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addWave}
                  className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                >
                  <Plus className="h-3 w-3" strokeWidth={2.5} />
                  Adicionar onda
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 pl-6 text-sm text-neutral-600 dark:text-neutral-400">
              <span className="shrink-0">Considerar &quot;não respondeu&quot; depois de</span>
              <input
                type="number"
                min={1}
                max={90}
                value={noReplyDays}
                onChange={(e) => setNoReplyDays(e.target.value)}
                className="field-input w-16 shrink-0 px-2 py-1 text-center"
              />
              <span className="shrink-0">dias</span>
            </div>
          </div>

          <div className="space-y-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
            <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <input
                type="checkbox"
                checked={useCustomDelay}
                onChange={(e) => setUseCustomDelay(e.target.checked)}
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
                  <span className="shrink-0">De</span>
                  <input
                    type="number"
                    min={SLIDER_MIN_SEC}
                    max={SLIDER_MAX_SEC}
                    value={delayMinSec}
                    onChange={(e) => setDelayMinSec(Number(e.target.value))}
                    className="field-input w-20 shrink-0 px-2 py-1 text-center"
                  />
                  <span className="shrink-0">a</span>
                  <input
                    type="number"
                    min={SLIDER_MIN_SEC}
                    max={SLIDER_MAX_SEC}
                    value={delayMaxSec}
                    onChange={(e) => setDelayMaxSec(Number(e.target.value))}
                    className="field-input w-20 shrink-0 px-2 py-1 text-center"
                  />
                  <span className="shrink-0">segundos</span>
                </div>
                <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                  {toMinutesLabel(delayMinSec)} a {toMinutesLabel(delayMaxSec)}
                </p>
              </div>
            ) : (
              <p className="pl-6 text-xs text-neutral-400 dark:text-neutral-500">
                Um tempo aleatório entre {toMinutesLabel(DEFAULT_DELAY_MIN)} e {toMinutesLabel(DEFAULT_DELAY_MAX)} será usado
                entre cada contato (padrão — ajuda a evitar bloqueios).
              </p>
            )}
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">
              Cancelar
            </button>
            <button type="button" onClick={handleSend} disabled={sending || !canSend} className="btn-primary">
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
  );
}
