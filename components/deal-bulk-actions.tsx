"use client";

import { useState, type ReactNode } from "react";
import { GitBranch, Layers, User, Send, CheckCircle2, XCircle, Tag, CalendarPlus, X, Archive } from "lucide-react";
import { SelectionBar } from "@/components/selection-bar";
import { BulkActionPopover } from "@/components/bulk-action-popover";
import { SelectPopoverBody } from "@/components/select-popover-body";
import { ClosedAtDialog } from "@/components/closed-at-dialog";
import { LossReasonDialog, type LossReasonOption } from "@/components/loss-reason-dialog";
import { BulkSendMessageDialog } from "@/components/bulk-send-message-dialog";
import { BulkCreateTasksDialog } from "@/components/bulk-create-tasks-dialog";
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
  layout = "bar",
  canArchive = false,
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
  /**
   * Como desenhar as MESMAS ações:
   * - "bar" (padrão, usado pela Lista): chip horizontal acima da tabela.
   * - "menu": uma embaixo da outra, para caber num menu de botão direito
   *   (ver o Kanban). Muda só a aparência — toda a lógica, os diálogos e a
   *   rota em lote continuam sendo exatamente os mesmos.
   */
  layout?: "bar" | "menu";
  /**
   * Mostra "Arquivar negócios" (ver Deal.archivedAt). Só o Kanban liga hoje:
   * é de lá que vem a ação de arquivar um card, e a janela "Arquivados" que
   * desfaz isso também vive no Pipeline. A Lista não oferece pra não criar
   * uma segunda porta de saída sem a porta de volta ao lado.
   */
  canArchive?: boolean;
}) {
  const pushUndoToast = useUndoToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wonOpen, setWonOpen] = useState(false);
  const [lossOpen, setLossOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(autoOpenSend ?? false);
  const [tasksOpen, setTasksOpen] = useState(false);

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
  const asMenu = layout === "menu";

  /**
   * Classe de cada ação que é um botão simples. Só a aparência muda entre os
   * dois formatos: no menu a linha ocupa a largura toda e alinha à esquerda;
   * na barra é um chip compacto.
   */
  function itemClass(tone: "neutral" | "won" | "lost" = "neutral") {
    const shape = asMenu
      ? "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm font-medium transition-colors disabled:opacity-50"
      : "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50";
    const colors =
      tone === "won"
        ? "text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
        : tone === "lost"
          ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
          : asMenu
            ? "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
            : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800";
    return `${shape} ${colors}`;
  }

  // As ações em si, idênticas nos dois formatos — só o invólucro muda (ver o
  // return mais abaixo). Extraídas para cá justamente para não existirem duas
  // cópias desta lista.
  const actions = (
    <>
        {otherPipelines.length > 0 && (
          <BulkActionPopover icon={GitBranch} label="Trocar de funil" variant={layout}>
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

        <BulkActionPopover icon={Layers} label="Trocar de etapa" variant={layout}>
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

        <BulkActionPopover icon={User} label="Responsável" variant={layout}>
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
          <BulkActionPopover icon={Tag} label="Trocar origem" variant={layout}>
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
          onClick={() => setTasksOpen(true)}
          disabled={busy}
          className={itemClass()}
        >
          <CalendarPlus className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          Marcar tarefa
        </button>

        <button
          type="button"
          onClick={() => setWonOpen(true)}
          disabled={busy}
          className={itemClass("won")}
        >
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          Marcar como ganho
        </button>

        <button
          type="button"
          onClick={() => setLossOpen(true)}
          disabled={busy}
          className={itemClass("lost")}
        >
          <XCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          Marcar como perdido
        </button>

        {canBulkMessage && (
          <button
            type="button"
            onClick={() => setSendOpen(true)}
            disabled={busy}
            className={itemClass()}
          >
            <Send className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            Enviar mensagem em massa
          </button>
        )}

        {canArchive && (
          <button
            type="button"
            onClick={() => apply({ action: "archive", archived: true }, "pipeline.massa.arquivar")}
            disabled={busy}
            className={itemClass()}
            title="Tira os selecionados do funil sem apagar — voltam pelo botão Arquivados"
          >
            <Archive className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            Arquivar {count === 1 ? "negócio" : "negócios"}
          </button>
        )}

        {extraActions}
    </>
  );

  return (
    <>
      {asMenu ? (
        <div className="min-w-[232px] py-1">
          {/* Quantos vão ser afetados, no topo: num menu que abre em cima de
              um card, sem isso a ação parece valer só pro card clicado. */}
          <div className="px-3 pt-1 pb-2 text-[11px] font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
            {count} selecionado{count === 1 ? "" : "s"}
          </div>
          {actions}
          <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />
          <button type="button" onClick={onClear} className={itemClass()}>
            <X className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            Limpar seleção
          </button>
          {error && <p className="px-3 pt-1 text-xs text-amber-600 dark:text-amber-400">{error}</p>}
        </div>
      ) : (
        <SelectionBar count={count} onClear={onClear}>
          {actions}
        </SelectionBar>
      )}

      {!asMenu && error && <p className="mt-1 w-full text-xs text-amber-600 dark:text-amber-400">{error}</p>}

      {wonOpen && (
        <ClosedAtDialog
          title={`Quando ${count === 1 ? "esse negócio foi ganho" : "esses negócios foram ganhos"}?`}
          confirmLabel="Marcar como ganho"
          confirmClassName="btn-primary bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-500"
          onClose={() => setWonOpen(false)}
          askAdministrator
          onConfirm={async (closedAt, extra) => {
            await apply(
              {
                action: "status",
                status: "WON",
                closedAt,
                ...(extra.administratorId ? { administratorId: extra.administratorId } : {}),
                ...(extra.creditType ? { creditType: extra.creditType } : {}),
              },
              "pipeline.massa.ganho",
            );
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
          onClose={() => setSendOpen(false)}
          onSent={async () => {
            trackUse("pipeline.massa.mensagem");
            onClear();
            await onApplied();
          }}
          onCreateScript={onCreateScript ?? (() => {})}
        />
      )}

      {tasksOpen && (
        <BulkCreateTasksDialog
          dealIds={selectedIds}
          onClose={() => setTasksOpen(false)}
          onCreated={async () => {
            onClear();
            await onApplied();
          }}
        />
      )}
    </>
  );
}
