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
 *
 * `dealsContext`: liga o bloco de "marcar negócio como
 * perdido" — só faz sentido onde o destinatário JÁ é negócio (Pipeline →
 * disparo em massa), nunca em LEAD_CAPTURE (negócio só nasce se/quando
 * responde, ver lib/campaigns/reply.ts) — pedido explícito: "a opção de
 * colocar 'não respondeu' em perdido deve estar com uma opção de dar
 * perdido ou não (hoje em dia não tem como)".
 */
export function RmktWavesFields({
  rmkt,
  scripts,
  dealsContext = false,
  showNoReplyDays = true,
}: {
  rmkt: UseRmktWavesReturn;
  scripts: ScriptOption[];
  dealsContext?: boolean;
  /** Leads usam o fim da última onda como prazo automático; negócios precisam do prazo visível para a perda. */
  showNoReplyDays?: boolean;
}) {
  function toggleMarkLost(checked: boolean) {
    rmkt.setMarkLostOnNoReply(checked);
  }

  return (
    <div className="space-y-3 border-t border-neutral-100 pt-5 dark:border-neutral-800">
      <label className="flex items-center gap-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        <input
          type="checkbox"
          checked={rmkt.rmktEnabled}
          onChange={(e) => rmkt.setRmktEnabled(e.target.checked)}
          className="accent-neutral-900 dark:accent-white"
        />
        Enviar remarketing
      </label>

      {rmkt.rmktEnabled && (
        <div className="space-y-2 pl-6">
          {rmkt.waves.map((wave, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">Dia</span>
              <input
                type="number"
                min={1}
                max={89}
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

      {/* Só no contexto de negócio já existente: lead novo não tem negócio
          para marcar como perdido antes de responder. */}
      {dealsContext && rmkt.rmktEnabled && (
        <div className="space-y-2 pl-6">
          <label className="flex items-center gap-2 text-sm font-medium text-neutral-800 dark:text-neutral-200">
            <input
              type="checkbox"
              checked={rmkt.markLostOnNoReply}
              onChange={(e) => toggleMarkLost(e.target.checked)}
              className="accent-neutral-900 dark:accent-white"
            />
            Considerar como perdido
          </label>
          {rmkt.markLostOnNoReply && (
            <div className="space-y-2 pl-6">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Motivo: Não respondeu</p>
            </div>
          )}
        </div>
      )}

      {showNoReplyDays && (!dealsContext || rmkt.markLostOnNoReply) && (
        <div className="flex items-center gap-2 pl-6 text-sm text-neutral-600 dark:text-neutral-400">
          <span className="shrink-0">{dealsContext ? "Considerar perdido após" : "Considerar sem resposta após"}</span>
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
      )}
    </div>
  );
}
