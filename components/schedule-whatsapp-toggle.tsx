"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Switch } from "./switch";
import { Select } from "./select";
import { VariablePills, SCRIPT_VARIABLES } from "./variable-pills";

type ScriptOption = { id: string; name: string; steps: { text: string; delayAfterSec: number }[] };

export type ScheduleWhatsAppValue = { enabled: boolean; message: string };

/**
 * "Enviar mensagem agendada para o lead" — toggle inline na própria aba
 * WhatsApp do registro rápido de atividade (ver deal-detail.tsx), no lugar
 * do fluxo antigo (criar a tarefa → um modal separado perguntava depois se
 * queria programar). Ligado, escreve a mensagem que vai sair sozinha no
 * Prazo/Horário da tarefa (ver POST /api/tasks/:id/schedule-message) — ou
 * escolhe um script já salvo pra usar o texto do 1º passo dele como ponto
 * de partida, ainda editável antes de enviar (só usa o texto, nunca o
 * script inteiro com seus delays — o motor de tarefa agendada manda uma
 * mensagem só, no horário exato, não uma sequência).
 */
export function ScheduleWhatsAppToggle({
  value,
  onChange,
  disabled,
}: {
  value: ScheduleWhatsAppValue;
  onChange: (v: ScheduleWhatsAppValue) => void;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<"write" | "script">("write");
  const [scripts, setScripts] = useState<ScriptOption[] | null>(null);
  const [loadingScripts, setLoadingScripts] = useState(false);
  const [scriptId, setScriptId] = useState("");
  const messageRef = useRef<HTMLTextAreaElement>(null);

  function loadScripts() {
    if (scripts || loadingScripts) return;
    setLoadingScripts(true);
    fetch("/api/message-scripts")
      .then((r) => r.json())
      .then((data) => setScripts(Array.isArray(data) ? data : []))
      .catch(() => setScripts([]))
      .finally(() => setLoadingScripts(false));
  }

  function toggleEnabled(next: boolean) {
    onChange({ enabled: next, message: next ? value.message : "" });
  }

  function pickScript(id: string) {
    setScriptId(id);
    const firstStepText = scripts?.find((s) => s.id === id)?.steps?.[0]?.text ?? "";
    onChange({ enabled: true, message: firstStepText });
  }

  function insertVariable(token: string) {
    const el = messageRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + token + el.value.slice(end);
    onChange({ enabled: true, message: next });
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-neutral-200 p-2.5 dark:border-neutral-800">
      <label className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
          Enviar mensagem agendada para o lead
        </span>
        <Switch
          checked={value.enabled}
          onChange={toggleEnabled}
          disabled={disabled}
          label="Enviar mensagem agendada para o lead"
        />
      </label>

      {disabled ? (
        <p className="text-[11px] text-neutral-400 dark:text-neutral-500">Defina um prazo pra poder agendar.</p>
      ) : (
        value.enabled && (
          <div className="space-y-2">
            <div className="inline-flex gap-0.5 rounded-md bg-neutral-100 p-0.5 text-[11px] font-medium dark:bg-neutral-800">
              <button
                type="button"
                onClick={() => setMode("write")}
                className={`rounded px-2 py-1 transition-colors ${
                  mode === "write"
                    ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-100"
                    : "text-neutral-500 dark:text-neutral-400"
                }`}
              >
                Escrever
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("script");
                  loadScripts();
                }}
                className={`rounded px-2 py-1 transition-colors ${
                  mode === "script"
                    ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-100"
                    : "text-neutral-500 dark:text-neutral-400"
                }`}
              >
                Usar script
              </button>
            </div>

            {mode === "script" &&
              (loadingScripts ? (
                <p className="flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500">
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.5} />
                  Carregando scripts…
                </p>
              ) : scripts && scripts.length === 0 ? (
                <p className="text-xs text-neutral-400 dark:text-neutral-500">Nenhum script salvo ainda.</p>
              ) : (
                <Select
                  value={scriptId}
                  onChange={pickScript}
                  className="w-full py-1.5 text-xs"
                  options={[{ value: "", label: "Escolher script..." }, ...(scripts ?? []).map((s) => ({ value: s.id, label: s.name }))]}
                />
              ))}

            <textarea
              ref={messageRef}
              value={value.message}
              onChange={(e) => onChange({ enabled: true, message: e.target.value })}
              placeholder="O que enviar pro lead?"
              rows={3}
              className="field-input text-sm"
            />
            <VariablePills variables={SCRIPT_VARIABLES} onInsert={insertVariable} />
          </div>
        )
      )}
    </div>
  );
}
