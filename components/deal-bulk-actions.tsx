"use client";

import { useState, type ReactNode } from "react";
import { GitBranch, Layers, User, Send, CheckCircle2, XCircle, Tag } from "lucide-react";
import { SelectionBar } from "@/components/selection-bar";
import { BulkActionPopover } from "@/components/bulk-action-popover";
import { SelectPopoverBody } from "@/components/select-popover-body";
import { ClosedAtDialog } from "@/components/closed-at-dialog";
import { LossReasonDialog, type LossReasonOption } from "@/components/loss-reason-dialog";
import { BulkSendMessageDialog } from "@/components/bulk-send-message-dialog";
import { useUndoToast } from "@/components/undo-provider";
import { trackUse } from "@/lib/feature-usage/track";
import type { FeatureKey } from "@/lib/feature-usage/features";

type PipelineOption = { id: string; name: string; stages: { id: string; name: string }[] };
type MemberOption = { id: string; name: string; active: boolean };

/**
 * Barra de ações em massa de negócios — MESMO componente na Lista e no
 * Kanban (antes só a Lista tinha isso, com ~250 linhas de handler próprias;
 * duplicar no Kanban significaria manter duas cópias das mesmas regras de
 * negócio em arquivos de 1.200+ linhas cada).
 *
 * Toda ação passa por POST /api/deals/bulk — UMA requisição, e não mais uma
 * por negócio (ver o comentário longo naquela rota: com "selecionar todos
 * da etapa" o caminho antigo chegaria a dezenas de milhares de consultas
 * simultâneas). Apagar é a única exceção, e continua fora daqui de
 * propósito: chega como `extraActions` de quem já tinha (a Lista), porque o
 * desfazer de exclusão guarda snapshot completo de cada linha, formato que
 * não cabe no agrupamento da rota em lote.
 */
export function DealBulkActions({
  selectedIds,
  pipelineId,
  pipelines,
  stages,
  members,
  lossReasons,
  leadSources,
  canBulkMessage,
  onApplied,
  onClear,
  extraActions,
  onCreateScript,
  autoOpenSend,
}: {
  selectedIds: string[];
  pipelineId: string;
  /** Pra "Trocar de funil" — o funil atual é filtrado fora pelo próprio componente. */
  pipelines: PipelineOption[];
  /** Etapas do funil ATUAL (destino de "Trocar de etapa"). */
  stages: { id: string; name: string }[];
  members: MemberOption[];
  lossReasons: LossReasonOption[];
  /** Lista canônica de Origens (Configurações → Origens) — ver a ressalva de "origem" abaixo. */
  leadSources: { label: string }[];
  canBulkMessage: boolean;
  /** Chamado depois de toda ação aplicada — o dono da tela decide como recarregar (a Lista rebusca a página; o Kanban rebusca as colunas). */
  onApplied: () => void | Promise<void>;
  onClear: () => void;
  /** Ações extras específicas de uma tela (hoje: "Apagar", só na Lista). */
  extraActions?: ReactNode;
  /** "+ Criar script" de dentro do envio em massa — a Lista guarda um rascunho da seleção antes de navegar (ver pipeline-bulk-send-draft.ts); o Kanban não tem esse fluxo, então cai no no-op. */
  onCreateScript?: () => void;
  /** Já monta com o envio em massa aberto — usado na volta de "+ Criar script" na Lista, que restaura a seleção salva e precisa reabrir o diálogo exatamente onde parou. */
  autoOpenSend?: boolean;
}) {
  const pushUndoToast = useUndoToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wonOpen, setWonOpen] = useState(false);
  const [lossOpen, setLossOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(autoOpenSend ?? false);

  const count = selectedIds.length;

  /**
   * Um único caminho pra toda ação: dispara, mostra o aviso de desfazer
   * (Ctrl+Z cobre o lote inteiro numa ação só, ver deal.bulkUpdate em
   * lib/undo/) e devolve o controle pra tela recarregar. `skipped` é
   * informação de verdade, não erro: uma etapa que exige valor recusa os
   * negócios sem valor, e a pessoa precisa saber quantos ficaram de fora.
   */
  async function apply(payload: Record<string, unknown>, feature?: FeatureKey) {
    if (feature) trackUse(feature);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/deals/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealIds: selectedIds, ...payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Não foi possível aplicar a ação.");
        return false;
      }
      if (data.undo) pushUndoToast(data.undo);
      if (data.skipped > 0 && data.skippedReason) {
        setError(`${data.updated} aplicado${data.updated === 1 ? "" : "s"} · ${data.skipped} fora: ${data.skippedReason}`);
      } else {
        onClear();
      }
      await onApplied();
      return true;
    } catch {
      setError("Falha de conexão. Tente novamente.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const otherPipelines = pipelines.filter((p) => p.id !== pipelineId);

  return (
    <>
      <SelectionBar count={count} onClear={onClear}>
        {otherPipelines.length > 0 && (
          <BulkActionPopover icon={GitBranch} label="Trocar de funil">
            {(close) => (
              <SelectPopoverBody
                busy={busy}
                options={otherPipelines.map((p) => ({ value: p.id, label: p.name }))}
                onApply={async (v) => {
                  // Vai sempre pra 1ª etapa do funil de destino — escolher
                  // funil E etapa no mesmo popover ficaria complexo demais;
                  // dá pra reposicionar depois normalmente. Mesma regra que
                  // a Lista já usava.
                  const target = otherPipelines.find((p) => p.id === v);
                  if (!target || target.stages.length === 0) return;
                  await apply({ action: "move", pipelineId: v, stageId: target.stages[0].id }, "pipeline.massa.funil");
                  close();
                }}
              />
            )}
          </BulkActionPopover>
        )}

        <BulkActionPopover icon={Layers} label="Trocar de etapa">
          {(close) => (
            <SelectPopoverBody
              busy={busy}
              options={stages.map((s) => ({ value: s.id, label: s.name }))}
              onApply={async (v) => {
                await apply({ action: "move", stageId: v }, "pipeline.massa.etapa");
                close();
              }}
            />
          )}
        </BulkActionPopover>

        <BulkActionPopover icon={User} label="Responsável">
          {(close) => (
            <SelectPopoverBody
              busy={busy}
              options={members.filter((m) => m.active).map((m) => ({ value: m.id, label: m.name }))}
              onApply={async (v) => {
                await apply({ action: "owner", ownerId: v }, "pipeline.massa.responsavel");
                close();
              }}
            />
          )}
        </BulkActionPopover>

        {leadSources.length > 0 && (
          <BulkActionPopover icon={Tag} label="Trocar origem">
            {(close) => (
              <SelectPopoverBody
                busy={busy}
                options={leadSources.map((s) => ({ value: s.label, label: s.label }))}
                onApply={async (v) => {
                  await apply({ action: "source", source: v }, "pipeline.massa.origem");
                  close();
                }}
              />
            )}
          </BulkActionPopover>
        )}

        <button
          type="button"
          onClick={() => setWonOpen(true)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
        >
          <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
          Marcar como ganho
        </button>

        <button
          type="button"
          onClick={() => setLossOpen(true)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-500/10"
        >
          <XCircle className="h-3.5 w-3.5" strokeWidth={2} />
          Marcar como perdido
        </button>

        {canBulkMessage && (
          <button
            type="button"
            onClick={() => setSendOpen(true)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <Send className="h-3.5 w-3.5" strokeWidth={2} />
            Enviar mensagem em massa
          </button>
        )}

        {extraActions}
      </SelectionBar>

      {error && <p className="mt-1 w-full text-xs text-amber-600 dark:text-amber-400">{error}</p>}

      {wonOpen && (
        <ClosedAtDialog
          title={`Quando ${count === 1 ? "esse negócio foi ganho" : "esses negócios foram ganhos"}?`}
          confirmLabel="Marcar como ganho"
          confirmClassName="btn-primary bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-500"
          onClose={() => setWonOpen(false)}
          onConfirm={async (closedAt) => {
            await apply({ action: "status", status: "WON", closedAt }, "pipeline.massa.ganho");
            setWonOpen(false);
          }}
        />
      )}

      {lossOpen && (
        <LossReasonDialog
          title={`Por que ${count === 1 ? "esse negócio foi perdido" : "esses negócios foram perdidos"}?`}
          lossReasons={lossReasons}
          initialReasonId={null}
          initialNote={null}
          onClose={() => setLossOpen(false)}
          onConfirm={async (lossReasonId, note, closedAt) => {
            await apply(
              { action: "status", status: "LOST", lossReasonId, lostReason: note || undefined, closedAt },
              "pipeline.massa.perdido",
            );
            setLossOpen(false);
          }}
        />
      )}

      {sendOpen && (
        <BulkSendMessageDialog
          dealIds={selectedIds}
          lossReasons={lossReasons}
          onClose={() => setSendOpen(false)}
          onSent={async () => {
            trackUse("pipeline.massa.mensagem");
            onClear();
            await onApplied();
          }}
          onCreateScript={onCreateScript ?? (() => {})}
        />
      )}
    </>
  );
}
