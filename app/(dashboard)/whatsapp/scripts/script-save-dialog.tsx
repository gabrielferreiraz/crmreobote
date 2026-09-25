"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/modal";

export type ScriptImpactDTO = {
  version: number;
  hasHistory: boolean;
  campaigns: { id: string; name: string; status: "DRAFT" | "RUNNING" | "PAUSED" | "DONE"; pendingCount: number }[];
};

export type ScriptSaveChoice = {
  versionMode: "FIX" | "NEW_VERSION";
  applyToCampaignIds: string[];
};

const STATUS_LABEL: Record<ScriptImpactDTO["campaigns"][number]["status"], string> = {
  DRAFT: "Rascunho",
  RUNNING: "Rodando",
  PAUSED: "Pausada",
  DONE: "Encerrada",
};

/**
 * Perguntas que só aparecem quando fazem sentido, na hora de SALVAR uma
 * edição de texto num script que já existe (ver lib/campaigns/script-sync.ts,
 * que explica o modelo inteiro):
 *
 *  1. "Correção ou nova versão?" — só se o script já foi enviado a alguém
 *     (`hasHistory`). Correção mantém a versão e os números continuam somando;
 *     nova versão recomeça a contar no relatório (v1 fica com os números de
 *     antes). A resposta padrão é SUGERIDA pelo tamanho da mudança
 *     (`suggestedMode`), nunca imposta.
 *  2. "Aplicar em quais campanhas em andamento?" — só se alguma campanha
 *     ativa (que a pessoa enxerga) usa o script. Vindo da biblioteca vem tudo
 *     marcado (o pedido é que a edição chegue nas campanhas); vindo da página
 *     de uma campanha, só ela. Nos dois casos é uma decisão explícita e
 *     visível: aplicar muda o que vai pra leads de verdade.
 */
export function ScriptSaveDialog({
  impact,
  suggestedMode,
  suggestionNote,
  preselectCampaignId,
  saving,
  error,
  onCancel,
  onConfirm,
}: {
  impact: ScriptImpactDTO;
  suggestedMode: "FIX" | "NEW_VERSION";
  /** Frase curta explicando POR QUE essa é a sugestão ("mudou ~60% do texto"). */
  suggestionNote: string;
  /** Campanha de onde a pessoa veio (botão "Editar" da página da campanha) — vem marcada sozinha. */
  preselectCampaignId?: string;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (choice: ScriptSaveChoice) => void;
}) {
  const [mode, setMode] = useState<"FIX" | "NEW_VERSION">(suggestedMode);
  // Veio da página de uma campanha → só ela vem marcada (as outras que usam o
  // mesmo script ficam listadas, desmarcadas: continuam com o texto de agora e
  // aparecem como "biblioteca tem texto novo" lá). Veio da biblioteca → tudo marcado.
  const [selected, setSelected] = useState<Set<string>>(() => {
    const fromCampaign = preselectCampaignId && impact.campaigns.find((c) => c.id === preselectCampaignId);
    return new Set(fromCampaign ? [fromCampaign.id] : impact.campaigns.map((c) => c.id));
  });

  const nextVersion = impact.version + 1;
  const applyCount = selected.size;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Modal onClose={saving ? () => {} : onCancel} maxWidth="max-w-lg">
      <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Salvar alterações no script</h2>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">O texto mudou. Antes de salvar, duas decisões:</p>

      <div className="space-y-5">
        {impact.hasHistory && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Isso conta como…</legend>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <input type="radio" name="versionMode" checked={mode === "FIX"} onChange={() => setMode("FIX")} className="mt-0.5" />
              <span className="text-sm">
                <span className="font-medium text-neutral-900 dark:text-neutral-100">Só uma correção</span>
                <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                  Continua sendo a v{impact.version}: os números de envios e respostas seguem somando juntos no relatório.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <input type="radio" name="versionMode" checked={mode === "NEW_VERSION"} onChange={() => setMode("NEW_VERSION")} className="mt-0.5" />
              <span className="text-sm">
                <span className="font-medium text-neutral-900 dark:text-neutral-100">Nova versão (v{nextVersion})</span>
                <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                  O relatório passa a contar a v{nextVersion} separado a partir de agora; a v{impact.version} fica com os números de antes.
                </span>
              </span>
            </label>
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              Sugestão: {suggestedMode === "NEW_VERSION" ? "nova versão" : "correção"} — {suggestionNote}.
            </p>
          </fieldset>
        )}

        {impact.campaigns.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Aplicar o texto novo nas campanhas em andamento</legend>
            <div className="space-y-1.5">
              {impact.campaigns.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-800">
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="mt-0.5" />
                  <span className="min-w-0 text-sm">
                    <span className="block truncate font-medium text-neutral-900 dark:text-neutral-100">{c.name}</span>
                    <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                      {STATUS_LABEL[c.status]}
                      {c.pendingCount > 0
                        ? ` · ${c.pendingCount} ainda ${c.pendingCount === 1 ? "vai" : "vão"} receber`
                        : " · ninguém pendente"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              Vale a partir do próximo envio de cada campanha. Quem já recebeu a mensagem antiga não muda. Desmarcadas continuam com o texto de agora.
            </p>
          </fieldset>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} disabled={saving} className="btn-ghost">
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onConfirm({ versionMode: impact.hasHistory ? mode : "FIX", applyToCampaignIds: Array.from(selected) })}
            className="btn-primary"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {applyCount > 0 ? `Salvar e aplicar em ${applyCount} campanha${applyCount === 1 ? "" : "s"}` : "Salvar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
