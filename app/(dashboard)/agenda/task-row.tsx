"use client";

import { useEffect, useState } from "react";
import { CircleAlert, ChevronRight, CalendarPlus, MessageCircle } from "lucide-react";
import { TASK_TYPE_LABELS, TASK_TYPE_ICON, TASK_TYPE_COLOR } from "@/lib/task-icons";
import { Avatar } from "@/components/avatar";
import { AnimatedCheck } from "@/components/animated-check";
import { buildGoogleCalendarUrl } from "@/lib/google-calendar";
import { TaskDetailModal } from "./task-detail-modal";
import { useMeetingOutcomeGate } from "./use-meeting-outcome-gate";

export type Task = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  dueAt: string | Date | null;
  completedAt: string | Date | null;
  createdAt: string | Date;
  scheduledMessageText: string | null;
  scheduledMessageSentAt: string | Date | null;
  scheduledMessageFailedAt: string | Date | null;
  deal: {
    id: string;
    name: string;
    value?: number | null;
    stageName?: string | null;
  } | null;
  contact: {
    id: string;
    name: string;
    phone?: string | null;
    source?: string | null;
    email?: string | null;
    jobTitle?: string | null;
    company?: string | null;
    city?: string | null;
  } | null;
  owner: { id: string; name: string; photoUrl: string | null };
};

/**
 * Rótulo pra mostrar na Agenda (lista) e no detalhe da tarefa quando ela tem
 * uma mensagem de WhatsApp programada (ver Task.scheduledMessageText no
 * schema e lib/tasks/scheduled-whatsapp.ts, que manda de verdade). null =
 * não é o caso (tarefa sem tipo/mensagem programada), então quem chama não
 * precisa mostrar nada.
 */
export function scheduledMessageStatus(task: Task): { label: string; tone: "neutral" | "green" | "red" } | null {
  if (task.type !== "WHATSAPP" || !task.scheduledMessageText) return null;
  const name = task.contact?.name ?? "o cliente";
  if (task.scheduledMessageSentAt) return { label: `Mensagem enviada para ${name}`, tone: "green" };
  if (task.scheduledMessageFailedAt) return { label: "Falha ao enviar automaticamente — envie manualmente", tone: "red" };
  if (task.completedAt) return { label: "Envio cancelado (tarefa finalizada antes da hora)", tone: "neutral" };
  if (!task.dueAt) return null;
  const d = new Date(task.dueAt);
  const date = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return { label: `Enviar mensagem para ${name} dia ${date} às ${time}`, tone: "neutral" };
}

/** "há 21d" em vez da data exata — pra quem faz o quê primeiro numa lista de
 * atrasadas, a GRAVIDADE do atraso (21 dias! vs 20 minutos) é o que importa
 * pra decisão, não o dia calendário. A data exata continua disponível no
 * `title=` (tooltip) do elemento, ninguém perde a informação, só deixa de
 * ser a leitura padrão. Mesmo texto/faixas de app/tv/tv-view.tsx
 * (formatRelativeTime) — cópia local de propósito, não vale a pena um
 * import cross-rota por uma função de 6 linhas usada só aqui e lá. */
function formatOverdueBy(date: Date): string {
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (diffMin < 60) return `há ${Math.max(1, diffMin)} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `há ${diffD}d`;
}

export function TaskRow({
  task,
  onToggle,
  onDelete,
  canDelete,
  muted,
  showOwner,
}: {
  task: Task;
  onToggle: (id: string, completed: boolean, meetingOutcome?: "ATTENDED" | "NO_SHOW" | "RESCHEDULED", newDueAt?: string) => void;
  onDelete?: (id: string) => Promise<void> | void;
  /** Só o Dono da organização pode excluir — ver TaskDetailModal. */
  canDelete?: boolean;
  muted?: boolean;
  showOwner?: boolean;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [completed, setCompleted] = useState(!!task.completedAt);
  const [justCompleted, setJustCompleted] = useState(false);
  const { requestComplete, dialog: outcomeDialog } = useMeetingOutcomeGate(onToggle);
  const Icon = TASK_TYPE_ICON[task.type] ?? TASK_TYPE_ICON.OTHER;
  const color = TASK_TYPE_COLOR[task.type] ?? TASK_TYPE_COLOR.OTHER;
  const overdue = !completed && !!task.dueAt && new Date(task.dueAt) < new Date();
  const msgStatus = scheduledMessageStatus(task);
  const MSG_STATUS_COLOR: Record<string, string> = {
    neutral: "text-neutral-500 dark:text-neutral-400",
    green: "text-emerald-600 dark:text-emerald-400",
    red: "text-red-600 dark:text-red-400",
  };

  // Quem é o cliente por trás da tarefa importa mais, pra decidir o que
  // fazer primeiro numa lista de 100+ atrasadas, do que o texto livre do
  // título ("vai conversar com esposo", "tentando agendar visita" — notas
  // de ligação, não identificam ninguém sozinhas). Contato/negócio viram a
  // linha PRINCIPAL (em negrito); o título vira uma nota secundária embaixo
  // — só quando carrega alguma informação de verdade além do que já está
  // óbvio (nome duplicado do contato, ou é literalmente o nome do tipo, ex.
  // título "Visita" numa tarefa já marcada como tipo Visita).
  const typeLabel = TASK_TYPE_LABELS[task.type] ?? task.type;
  const identity = task.contact?.name?.trim() || task.deal?.name?.trim() || null;
  // Negócio e contato costumam vir com o MESMO nome (o negócio é nomeado a
  // partir do cliente) — mostrar os dois só quando de fato diferem, senão é
  // "Fulano · Fulano" repetido à toa (ver print).
  const secondaryIdentity =
    task.contact?.name && task.deal?.name && task.contact.name.trim() !== task.deal.name.trim()
      ? task.deal.name
      : null;
  const titleTrimmed = task.title.trim();
  const isRedundantTitle =
    !titleTrimmed ||
    titleTrimmed.toLowerCase() === typeLabel.toLowerCase() ||
    (identity !== null && titleTrimmed.toLowerCase() === identity.toLowerCase());
  const primaryLabel = identity ?? task.title;
  const noteLine = identity && !isRedundantTitle ? task.title : null;

  useEffect(() => {
    setCompleted(!!task.completedAt);
  }, [task.completedAt]);

  function handleToggle(e?: React.MouseEvent) {
    e?.stopPropagation();
    const next = !completed;
    // Concluindo (não desmarcando) uma Reunião/Visita — precisa do
    // resultado antes de seguir (ver use-meeting-outcome-gate.tsx).
    if (next && requestComplete(task)) return;
    setCompleted(next);
    if (next) {
      setJustCompleted(true);
      setTimeout(() => setJustCompleted(false), 500);
    }
    onToggle(task.id, next);
  }

  return (
    <>
      {/* Redesenhado (2 rodadas) — 1ª: parou de espremer ícone+título+badge
          colorida+avatar+data em vermelho+botão "Google Agenda" com borda
          numa fileira só (título sempre truncava primeiro: "Cobrar...",
          "FOMOS A..."). 2ª: reordenou a HIERARQUIA — quem é o cliente
          (identity, ver acima) virou a linha principal em negrito, o texto
          livre da tarefa (title) desceu pra nota secundária, e tipo/prazo/
          negócio formam a linha mais discreta de todas por último. Botão do
          Google Agenda é só ícone, só no hover (mesmo padrão de icon-btn +
          opacity-0 group-hover:opacity-100 já usado no resto do app pra
          ações secundárias). */}
      <div className={`card group text-sm ${muted ? "opacity-60" : ""}`}>
        <div
          className="flex cursor-pointer items-start gap-3 rounded-lg p-4 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
          onClick={() => setModalOpen(true)}
        >
          {/* Status icon — clicável independente pra toggle */}
          <button
            type="button"
            onClick={handleToggle}
            className="tap-target mt-0.5 max-lg:-m-2 shrink-0"
            aria-label={completed ? "Marcar como pendente" : "Marcar como concluída"}
          >
            {completed ? (
              <AnimatedCheck className="h-[18px] w-[18px] text-emerald-500" justDrawn={justCompleted} />
            ) : overdue ? (
              <CircleAlert className="h-[18px] w-[18px] text-red-500" strokeWidth={2} />
            ) : (
              <Icon className={`h-[18px] w-[18px] ${color.text}`} strokeWidth={2} />
            )}
          </button>

          <div className="min-w-0 flex-1">
            {/* Linha PRINCIPAL — quem é o cliente (contato, ou o negócio se
                não tiver contato vinculado), não o texto livre da tarefa.
                text-[15px]: um degrau acima do resto da linha (13-14px),
                a maior fonte da linha inteira, de propósito. */}
            <p
              className={`truncate text-[15px] font-semibold ${
                completed ? "text-neutral-400 line-through dark:text-neutral-500" : "text-neutral-900 dark:text-neutral-100"
              }`}
            >
              {primaryLabel}
            </p>

            {/* Nota (o texto livre da tarefa) — só quando carrega alguma
                informação de verdade além do óbvio (ver isRedundantTitle
                acima). 1 linha só, trunca: é contexto de apoio, não o
                título mais importante da lista de novo. */}
            {noteLine && (
              <p className="mt-0.5 truncate text-sm text-neutral-500 dark:text-neutral-400">{noteLine}</p>
            )}

            {/* Metadados — a linha mais discreta de todas: tipo (pontinho
                colorido, não pílula cheia), prazo (gravidade do atraso em
                "há Xd", não a data crua — ver formatOverdueBy; data exata
                ainda no title=), e o negócio quando difere do contato já
                mostrado em cima. */}
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-neutral-400 dark:text-neutral-500">
              <span className="inline-flex shrink-0 items-center gap-1.5">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color.dot}`} />
                {typeLabel}
              </span>
              {task.dueAt && (
                <>
                  <span className="text-neutral-300 dark:text-neutral-700">·</span>
                  <span
                    className={overdue ? "font-semibold text-red-600 dark:text-red-400" : ""}
                    title={new Date(task.dueAt).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  >
                    {overdue
                      ? formatOverdueBy(new Date(task.dueAt))
                      : new Date(task.dueAt).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                  </span>
                </>
              )}
              {secondaryIdentity && (
                <>
                  <span className="text-neutral-300 dark:text-neutral-700">·</span>
                  <span className="min-w-0 truncate">{secondaryIdentity}</span>
                </>
              )}
            </div>

            {msgStatus && (
              <div className={`mt-1 flex items-center gap-1 text-xs ${MSG_STATUS_COLOR[msgStatus.tone]}`}>
                <MessageCircle className="h-3 w-3 shrink-0" strokeWidth={2} />
                <span className="truncate">{msgStatus.label}</span>
              </div>
            )}
          </div>

          {/* Cluster de ações secundárias — dono (se aplicável) + link pro
              Google Agenda (só ícone, só no hover) + chevron. */}
          <div className="flex shrink-0 items-center gap-1">
            {showOwner && <Avatar name={task.owner.name} src={task.owner.photoUrl} size="xs" />}
            {task.dueAt && (
              <a
                href={buildGoogleCalendarUrl({ title: task.title, description: task.description, start: task.dueAt })}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="icon-btn opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 coarse:opacity-100"
                title="Adicionar ao Google Agenda"
              >
                <CalendarPlus className="h-3.5 w-3.5" strokeWidth={2} />
              </a>
            )}
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-300 dark:text-neutral-600" strokeWidth={2} />
          </div>
        </div>
      </div>

      {modalOpen && (
        <TaskDetailModal
          task={task}
          completed={completed}
          justCompleted={justCompleted}
          onClose={() => setModalOpen(false)}
          onToggle={() => {
            handleToggle();
            setModalOpen(false);
          }}
          canDelete={canDelete}
          onDelete={onDelete}
        />
      )}
      {outcomeDialog}
    </>
  );
}
