import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { X, Lightbulb, AlertTriangle, MessageCircle, Zap, ChevronRight, CheckCircle2 } from "lucide-react";
import { Loader2 } from "lucide-react";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { EvaluatedTip, TipPayload } from "@/lib/productivity-tips/types";

type DismissMode = "today" | "forever";

const TIP_ICONS: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  WHATSAPP_DISCONNECTED: WhatsAppIcon,
  NOSHOW_DEALS: AlertTriangle,
  MANY_WHATSAPP_TASKS: MessageCircle,
  STALE_DEALS: Zap,
  NO_MESSAGE_SCRIPTS: MessageCircle,
};

function TipIcon({ tipType }: { tipType: string }) {
  const Icon = TIP_ICONS[tipType] ?? Lightbulb;
  return <Icon className="h-5 w-5 shrink-0" strokeWidth={2} />;
}

export function ProductivityTipShell({
  tip,
  onDismiss,
  onConsume,
  extraButtons,
  children,
}: {
  tip: EvaluatedTip;
  onDismiss: (mode: DismissMode) => void;
  onConsume?: () => void;
  extraButtons?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-live="polite"
      className="surface-glass-panel fixed bottom-4 right-4 z-40 w-full max-w-md rounded-2xl p-4 shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
      style={{ animation: "panel-pop-in 380ms var(--ease-spring)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              tip.tipType === "WHATSAPP_DISCONNECTED"
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                : tip.tipType === "NOSHOW_DEALS"
                  ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                  : tip.tipType === "MANY_WHATSAPP_TASKS"
                    ? "bg-brand/10 text-brand dark:bg-brand/20 dark:text-brand-200"
                    : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
            }`}
          >
            <TipIcon tipType={tip.tipType} />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
              Dica de produtividade
            </p>
            <div className="space-y-2">{children}</div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onDismiss("forever")}
              className="icon-btn -mr-1 !p-1.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
              title="Sempre ignorar esta dica"
              aria-label="Sempre ignorar esta dica"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M4.93 4.93l14.14 14.14" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => onDismiss("today")}
              className="icon-btn -mr-1 !p-1.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              title="Hoje não mostrar novamente"
              aria-label="Fechar dica por hoje"
            >
              <X className="h-4 w-4" strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={() => onDismiss("today")} className="btn-ghost">
          Agora não
        </button>
        {extraButtons}
        {onConsume && (
          <button type="button" onClick={onConsume} className="btn-primary">
            Prosseguir
            <ChevronRight className="h-4 w-4 -mr-1" strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}

// ──── WhatsApp Disconnected ─────────────────────────────────────────

export function WhatsAppDisconnectedTip({
  tip,
  onDismiss,
}: {
  tip: EvaluatedTip;
  onDismiss: (mode: DismissMode) => void;
}) {
  const router = useRouter();
  return (
    <ProductivityTipShell
      tip={tip}
      onDismiss={onDismiss}
      onConsume={() => router.push("/configuracoes/whatsapp")}
    >
      <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        Conecte rapidamente o seu WhatsApp
      </p>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Sem número conectado, as mensagens automáticas e os contatos não recebem o seu follow-up.
        Conecte agora em 1 clique.
      </p>
    </ProductivityTipShell>
  );
}

// ──── NoShow Deals ─────────────────────────────────────────────────

export function NoShowDealsTip({
  tip,
  onDismiss,
  onPickBatch,
}: {
  tip: EvaluatedTip;
  onDismiss: (mode: DismissMode) => void;
  onPickBatch: (dealIds: string[]) => void;
}) {
  const payload = tip.payload as Extract<TipPayload, { type: "NOSHOW_DEALS" }>;
  const many = payload.count > payload.safeBatch;
  const [askingAll, setAskingAll] = useState(false);

  return (
    <>
      <ProductivityTipShell
        tip={tip}
        onDismiss={onDismiss}
        extraButtons={
          many ? (
            <button
              type="button"
              onClick={() => setAskingAll(true)}
              className="btn-secondary"
              title="Seleciona TODO o volume da etapa — risco maior de banimento em número QR Code"
            >
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" strokeWidth={2} />
              Todos da etapa ({payload.dealIdsAll.length})
            </button>
          ) : null
        }
        onConsume={() => onPickBatch(payload.dealIdsAll.slice(0, payload.safeBatch))}
      >
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          Há <span className="text-amber-700 dark:text-amber-400">{payload.count}</span> negócios na etapa “
          {payload.stageName}”
        </p>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {many ? (
            <>
              Separei os {payload.safeBatch} mais recentes pra você disparar com segurança agora. Quer
              prosseguir?
            </>
          ) : (
            <>Envie uma mensagem de recuperação em massa para todos — já selecionei todos.</>
          )}
        </p>
        {many && (
          <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-400">
            Se usar número conectado via QR Code, disparar muitos de uma vez tem risco maior de
            banimento. Se for API oficial da Meta, é seguro disparar todos.
          </p>
        )}
      </ProductivityTipShell>

      {askingAll && (
        <ConfirmDialog
          title={`Enviar para ${payload.dealIdsAll.length} negócios?`}
          description={
            payload.dealIdsAll.length < payload.count
              ? `Usar um volume grande de disparos num número conectado via QR Code (Evolution) aumenta o risco de banimento temporário ou permanente pela Meta. Recomendamos disparar em lotes menores. A etapa tem ${payload.count} negócios ao todo — por segurança, selecionamos os ${payload.dealIdsAll.length} mais recentes. Tem certeza que quer prosseguir?`
              : "Usar um volume grande de disparos num número conectado via QR Code (Evolution) aumenta o risco de banimento temporário ou permanente pela Meta. Recomendamos disparar em lotes menores. Tem certeza que quer selecionar TODOS?"
          }
          confirmLabel="Selecionar todos mesmo assim"
          onClose={() => setAskingAll(false)}
          onConfirm={() => {
            setAskingAll(false);
            onPickBatch(payload.dealIdsAll);
          }}
        />
      )}
    </>
  );
}

// ──── Many WhatsApp Tasks ──────────────────────────────────────────

export function ManyWhatsAppTasksTip({
  tip,
  onDismiss,
  onScheduleAll,
}: {
  tip: EvaluatedTip;
  onDismiss: (mode: DismissMode) => void;
  onScheduleAll: (taskIds: string[]) => void;
}) {
  const payload = tip.payload as Extract<TipPayload, { type: "MANY_WHATSAPP_TASKS" }>;
  const hasUnscheduled = payload.unscheduledIds.length > 0;
  const router = useRouter();

  return (
    <ProductivityTipShell
      tip={tip}
      onDismiss={onDismiss}
      extraButtons={
        <button
          type="button"
          onClick={() => router.push("/agenda")}
          className="btn-secondary"
        >
          <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
          Ver na agenda
        </button>
      }
      onConsume={
        hasUnscheduled ? () => onScheduleAll(payload.unscheduledIds) : undefined
      }
    >
      <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        {payload.todayCount > 0
          ? `${payload.todayCount} tarefa${payload.todayCount === 1 ? "" : "s"} de WhatsApp para hoje`
          : `${payload.weekCount} tarefas de WhatsApp para essa semana`}
      </p>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        {hasUnscheduled
          ? "Posso abrir a agenda já selecionando essas tarefas e deixar você programar mensagens automáticas para cada uma. Quer agendar agora?"
          : "Todas já têm mensagem programada — mas dá uma olhada lá para garantir que tudo saia no horário certo."}
      </p>
      {!hasUnscheduled && (
        <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.5} />
          Todas as de hoje já têm mensagem programada
        </div>
      )}
    </ProductivityTipShell>
  );
}
