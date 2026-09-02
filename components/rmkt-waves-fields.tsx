"use client";

import { Plus, X } from "lucide-react";
import { Select } from "@/components/select";
import type { UseRmktWavesReturn } from "@/lib/use-rmkt-waves";

type ScriptOption = { id: string; name: string };

/**
 * UI de "RMKT" (ondas de reengajamento) — extraída de
 * components/send-leads-dialog.tsx pra ser reaproveitada junto com o hook
 * (ver lib/use-rmkt-waves.ts, mesmo comentário lá explica o porquê). Só
 * apresentacional: todo o estado vem de fora (`rmkt`, o retorno do hook).
 */
export function RmktWavesFields({ rmkt, scripts }: { rmkt: UseRmktWavesReturn; scripts: ScriptOption[] }) {
  return (
    <div className="space-y-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
      <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
        <input
          type="checkbox"
          checked={rmkt.rmktEnabled}
          onChange={(e) => rmkt.setRmktEnabled(e.target.checked)}
          className="accent-neutral-900 dark:accent-white"
        />
        Enviar RMKT pra quem não responder
      </label>

      {rmkt.rmktEnabled && (
        <div className="space-y-2 pl-6">
          {rmkt.waves.map((wave, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">Dia</span>
              <input
                type="number"
                min={1}
                value={wave.dayOffset}
                onChange={(e) => rmkt.updateWave(i, { dayOffset: e.target.value })}
                className="field-input w-16 shrink-0 px-2 py-1 text-center text-sm"
              />
              <Select
                value={wave.scriptId}
                onChange={(v) => rmkt.updateWave(i, { scriptId: v })}
                className="min-w-0 flex-1 py-1.5 text-sm"
                options={[{ value: "", label: "Selecione o script" }, ...scripts.map((s) => ({ value: s.id, label: s.name }))]}
              />
              <button
                type="button"
                onClick={() => rmkt.removeWave(i)}
                className="icon-btn h-7 w-7 shrink-0"
                aria-label="Remover onda"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={rmkt.addWave}
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
          value={rmkt.noReplyDays}
          onChange={(e) => rmkt.setNoReplyDays(e.target.value)}
          className="field-input w-16 shrink-0 px-2 py-1 text-center"
        />
        <span className="shrink-0">dias</span>
      </div>
    </div>
  );
}
