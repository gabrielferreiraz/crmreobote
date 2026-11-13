"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  BellOff,
  BellRing,
  Check,
  CircleCheck,
  ClipboardCheck,
  Clock3,
  Eye,
  FileWarning,
  Loader2,
  UserPlus,
  X as XIcon,
} from "lucide-react";
import { TASK_TYPE_LABELS, TASK_TYPE_ICON } from "@/lib/task-icons";
import { formatCurrency } from "@/lib/format";
import { usePushSubscription } from "@/lib/use-push-subscription";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { LeadRequestContactModal } from "@/components/lead-request-contact-modal";

type NotificationTask = {
  id: string;
  type: string;
  title: string;
  dueAt: string | null;
  deal: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  quotaRegistration: {
    consultant: string;
    value: number | null;
    requestedAt: string;
  } | null;
  consultantRequest: {
    requestedBy: string;
    text: string;
    requestedAt: string;
  } | null;
  /** true = dueAt já passou de verdade; false = ainda dentro de hoje (ver app/api/tasks/notifications/route.ts). */
  overdue: boolean;
};

type LeadRequestNotification = {
  id: string;
  createdAt: string;
  contact: { id: string; name: string };
  requester: { id: string; name: string };
  /** Pra quem o lead vai se aprovado, só quando é ALGUÉM DIFERENTE de quem
   * pediu (ex.: admin importando planilha "pro Fulano") — null = pedido
   * normal, pra própria carteira de quem pediu. */
  assignee: { id: string; name: string } | null;
};

const POLL_INTERVAL_MS = 30_000;

type NotificationBellContextValue = {
  tasks: NotificationTask[];
  leadRequests: LeadRequestNotification[];
  removeTask: (id: string) => void;
  removeLeadRequest: (id: string) => void;
};

const NotificationBellContext = createContext<NotificationBellContextValue | null>(null);

/** Share one polling loop between the desktop and mobile header triggers. */
export function NotificationBellProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<NotificationTask[]>([]);
  const [leadRequests, setLeadRequests] = useState<LeadRequestNotification[]>([]);

  useVisiblePoll(async () => {
    const [tasksRes, leadRequestsRes] = await Promise.all([
      fetch("/api/tasks/notifications"),
      fetch("/api/lead-requests"),
    ]);
    await Promise.all([
      tasksRes.ok ? tasksRes.json().then(setTasks) : Promise.resolve(),
      leadRequestsRes.ok ? leadRequestsRes.json().then(setLeadRequests) : Promise.resolve(),
    ]);
  }, POLL_INTERVAL_MS);

  function removeLeadRequest(id: string) {
    setLeadRequests((current) => current.filter((request) => request.id !== id));
  }

  function removeTask(id: string) {
    setTasks((current) => current.filter((task) => task.id !== id));
  }

  return (
    <NotificationBellContext.Provider value={{ tasks, leadRequests, removeTask, removeLeadRequest }}>
      {children}
    </NotificationBellContext.Provider>
  );
}

export function NotificationBell() {
  const notifications = useContext(NotificationBellContext);
  if (!notifications) throw new Error("NotificationBell must be rendered inside NotificationBellProvider");
  const { tasks, leadRequests, removeTask, removeLeadRequest } = notifications;
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [handlingTaskId, setHandlingTaskId] = useState<string | null>(null);
  const [taskFeedback, setTaskFeedback] = useState<{ id: string; action: "snooze" | "complete" } | null>(null);
  const [dismissingTaskId, setDismissingTaskId] = useState<string | null>(null);
  const [taskActionError, setTaskActionError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Pedido de lead que está aberto no popup "Ver cliente" (ver
  // LeadRequestContactModal) — guarda o request inteiro, não só o
  // contactId, porque o popup também precisa saber PRA QUAL pedido
  // aprovar/recusar (o mesmo botão do popup resolve o pedido certo).
  const [previewRequest, setPreviewRequest] = useState<LeadRequestNotification | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { status: pushStatus, loading: pushLoading, subscribe, unsubscribe } = usePushSubscription();

  async function handleConsultantRequestTask(taskId: string, action: "snooze" | "complete") {
    setHandlingTaskId(taskId);
    setTaskActionError(null);
    try {
      const body = action === "complete"
        ? { completed: true }
        : { dueAt: new Date(Date.now() + 60 * 60_000).toISOString() };
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setTaskActionError(data.error ?? "Não foi possível atualizar o lembrete.");
        return;
      }
      setTaskFeedback({ id: taskId, action });
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      setDismissingTaskId(taskId);
      await new Promise((resolve) => window.setTimeout(resolve, 180));
      removeTask(taskId);
    } catch {
      setTaskActionError("Sem conexão. Tente novamente.");
    } finally {
      setHandlingTaskId(null);
      setTaskFeedback(null);
      setDismissingTaskId(null);
    }
  }

  // Aprovar/recusar direto do sino — sem sair da tela nem abrir mais nada
  // (pedido explícito: "mostra um modal pequeno logo abaixo do sino"; este
  // painel JÁ é esse "modal pequeno", não precisa de um segundo).
  async function resolveLeadRequest(id: string, action: "approve" | "decline") {
    setResolvingId(id);
    try {
      const res = await fetch(`/api/lead-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        removeLeadRequest(id);
        // Resolveu pelo popup "Ver cliente" — fecha junto, o pedido nem
        // existe mais pra continuar mostrando.
        setPreviewRequest((prev) => (prev?.id === id ? null : prev));
      }
    } finally {
      setResolvingId(null);
    }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const showPushToggle = pushStatus !== "unsupported";
  const isSubscribed = pushStatus === "subscribed";
  // Cadastro de cota e uma fila administrativa, nao uma tarefa atrasada.
  // As tarefas de agenda continuam divididas pela urgencia real.
  const quotaRegistrationTasks = tasks.filter((task) => task.quotaRegistration !== null);
  const consultantRequestTasks = tasks.filter((task) => task.consultantRequest !== null);
  const scheduleTasks = tasks.filter((task) => task.quotaRegistration === null && task.consultantRequest === null);
  // Atrasadas primeiro (mais urgente), depois as de hoje ainda não vencidas
  // — os dois grupos já vêm ordenados por dueAt crescente (ver a query),
  // então só filtrar preserva a ordem cronológica dentro de cada um.
  const overdueTasks = scheduleTasks.filter((task) => task.overdue);
  const todayTasks = scheduleTasks.filter((task) => !task.overdue);
  const totalCount = tasks.length + leadRequests.length;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notificações"
        // Âncora do tour guiado da Central de ajuda (ver lib/help/tours.ts).
        data-help="notifications"
        className={`icon-btn relative h-9 w-9 ${
          consultantRequestTasks.length > 0
            ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
            : ""
        }`}
      >
        {consultantRequestTasks.length > 0 ? <BellRing className="notification-bell-attention h-4 w-4" strokeWidth={2} /> : <Bell className="h-4 w-4" strokeWidth={2} />}
        {totalCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold leading-none text-white">
            {totalCount > 9 ? "9+" : totalCount}
          </span>
        )}
      </button>

      {!open && consultantRequestTasks.length > 0 && (
        <ConsultantRequestNudge
          task={consultantRequestTasks[0]}
          total={consultantRequestTasks.length}
          busy={handlingTaskId === consultantRequestTasks[0].id}
          feedback={taskFeedback?.id === consultantRequestTasks[0].id ? taskFeedback.action : null}
          leaving={dismissingTaskId === consultantRequestTasks[0].id}
          error={taskActionError}
          onOpen={() => setOpen(true)}
          onSnooze={() => void handleConsultantRequestTask(consultantRequestTasks[0].id, "snooze")}
          onComplete={() => void handleConsultantRequestTask(consultantRequestTasks[0].id, "complete")}
        />
      )}

      {open && (
        <div className="surface-glass-panel animate-pop-in absolute right-0 z-40 mt-2 w-80 rounded-lg">
          <div className="border-b border-neutral-100 dark:border-neutral-800 px-4 py-2.5">
            <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
              Pendências
            </p>
          </div>
          {leadRequests.length > 0 && (
            <LeadRequestsGroup
              requests={leadRequests}
              resolvingId={resolvingId}
              onResolve={resolveLeadRequest}
              onPreview={setPreviewRequest}
            />
          )}
          <div className="scrollbar-thin max-h-96 overflow-y-auto pb-1">
            {tasks.length === 0 ? (
              // Só mostra "nenhuma tarefa" quando não tem NADA no painel —
              // com pedido de lead em cima, repetir "nenhuma tarefa
              // pendente" logo abaixo lê estranho (tem, sim, algo pendente
              // ali em cima, só não é tarefa).
              leadRequests.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">
                  Nenhuma tarefa pendente.
                </p>
              )
            ) : (
              <>
                {consultantRequestTasks.length > 0 && (
                  <ConsultantRequestGroup
                    tasks={consultantRequestTasks}
                    handlingTaskId={handlingTaskId}
                    feedback={taskFeedback}
                    dismissingTaskId={dismissingTaskId}
                    error={taskActionError}
                    onNavigate={() => setOpen(false)}
                    onSnooze={(id) => void handleConsultantRequestTask(id, "snooze")}
                    onComplete={(id) => void handleConsultantRequestTask(id, "complete")}
                  />
                )}
                {quotaRegistrationTasks.length > 0 && (
                  <QuotaRegistrationGroup tasks={quotaRegistrationTasks} onNavigate={() => setOpen(false)} />
                )}
                {overdueTasks.length > 0 && (
                  <NotificationGroup label="Atrasadas" tasks={overdueTasks} tone="red" onNavigate={() => setOpen(false)} />
                )}
                {todayTasks.length > 0 && (
                  <NotificationGroup label="Hoje" tasks={todayTasks} tone="amber" onNavigate={() => setOpen(false)} />
                )}
              </>
            )}
          </div>

          {/* Footer: link agenda + botão silenciar/ativar push */}
          <div className="flex items-center justify-between border-t border-neutral-100 dark:border-neutral-800 px-4 py-2 gap-3">
            <Link
              href={quotaRegistrationTasks.length > 0 && scheduleTasks.length === 0 ? "/cadastros" : "/agenda"}
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:underline"
            >
              {quotaRegistrationTasks.length > 0 && scheduleTasks.length === 0 ? "Abrir cadastros" : "Ver agenda completa"}
            </Link>

            {showPushToggle && (
              <button
                onClick={isSubscribed ? unsubscribe : subscribe}
                disabled={pushLoading || pushStatus === "checking"}
                title={isSubscribed ? "Silenciar notificações push" : "Ativar notificações push"}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  isSubscribed
                    ? "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20"
                }`}
              >
                {pushLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : isSubscribed ? (
                  <BellOff className="h-3 w-3" strokeWidth={2} />
                ) : (
                  <Bell className="h-3 w-3" strokeWidth={2} />
                )}
                {pushStatus === "checking" ? "…" : isSubscribed ? "Silenciar" : "Ativar avisos"}
              </button>
            )}
          </div>
        </div>
      )}

      {previewRequest && (
        <LeadRequestContactModal
          contactId={previewRequest.contact.id}
          onClose={() => setPreviewRequest(null)}
          onApprove={() => resolveLeadRequest(previewRequest.id, "approve")}
          onDecline={() => resolveLeadRequest(previewRequest.id, "decline")}
          resolving={resolvingId === previewRequest.id}
        />
      )}
    </div>
  );
}

/** Solicitação crítica do administrativo, persistente até adiar ou concluir o lembrete. */
function consultantRequestHref(task: NotificationTask) {
  return task.deal ? `/negocios/${task.deal.id}#pedido-administrativo` : "/agenda";
}

function consultantRequestContact(task: NotificationTask) {
  return task.contact?.name ?? task.deal?.name ?? task.title.replace(/^Enviar documento:\s*/i, "");
}

function requestWhen(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Campo_Grande",
  });
}

function ConsultantRequestNudge({
  task,
  total,
  busy,
  feedback,
  leaving,
  error,
  onOpen,
  onSnooze,
  onComplete,
}: {
  task: NotificationTask;
  total: number;
  busy: boolean;
  feedback: "snooze" | "complete" | null;
  leaving: boolean;
  error: string | null;
  onOpen: () => void;
  onSnooze: () => void;
  onComplete: () => void;
}) {
  const request = task.consultantRequest!;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`surface-glass-panel animate-pop-in absolute top-11 right-0 z-50 w-[calc(100vw-1.5rem)] max-w-[22rem] origin-top-right overflow-hidden rounded-lg border border-neutral-200 shadow-2xl transition duration-200 ease-out dark:border-neutral-700 ${
        leaving ? "pointer-events-none translate-y-1 scale-[0.98] opacity-0" : "translate-y-0 scale-100 opacity-100"
      }`}
    >
      <div className="h-0.5 bg-amber-500" />
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-2">
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          <FileWarning className="h-4 w-4" strokeWidth={2} />
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white motion-safe:animate-pulse dark:ring-neutral-900" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-5 text-neutral-900 dark:text-neutral-100">Cadastro aguardando você</p>
              <p className="truncate text-sm text-neutral-700 dark:text-neutral-300">{consultantRequestContact(task)}</p>
            </div>
            {total > 1 && (
              <button
                type="button"
                onClick={onOpen}
                className="shrink-0 rounded-md bg-neutral-100 px-2 py-1 text-[11px] font-semibold text-neutral-600 transition-colors hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                title="Ver todas as solicitações"
              >
                +{total - 1}
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="px-4 pb-3">
        <p className="text-sm font-medium leading-5 text-neutral-800 dark:text-neutral-200">{request.text}</p>
        <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          {request.requestedBy} · {requestWhen(request.requestedAt)}
        </p>
      </div>
      {error && (
        <p className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{error}</p>
      )}
      {feedback ? (
        <div
          className={`animate-pop-in flex items-center gap-2 border-t px-4 py-3 text-sm font-medium ${
            feedback === "complete"
              ? "border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
              : "border-neutral-100 bg-neutral-50 text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
          }`}
        >
          {feedback === "complete" ? <CircleCheck className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
          {feedback === "complete" ? "Marcado como concluído" : "Lembro você novamente em 1 hora"}
        </div>
      ) : (
        <div className="border-t border-neutral-100 px-3 py-3 dark:border-neutral-800">
          <Link href={consultantRequestHref(task)} className="btn-primary w-full justify-center" title="Abrir a venda e atender a solicitação">
            <Eye className="h-4 w-4" strokeWidth={2} /> Abrir cadastro
          </Link>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onSnooze}
              disabled={busy}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-neutral-200 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-50 disabled:cursor-wait disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              title="Lembrar novamente em 1 hora"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock3 className="h-3.5 w-3.5" />}
              Lembrar em 1h
            </button>
            <button
              type="button"
              onClick={onComplete}
              disabled={busy}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-emerald-200 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60 dark:border-emerald-500/30 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
              title="Concluir lembrete"
            >
              <CircleCheck className="h-3.5 w-3.5" /> Concluir
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ConsultantRequestGroup({
  tasks,
  handlingTaskId,
  feedback,
  dismissingTaskId,
  error,
  onNavigate,
  onSnooze,
  onComplete,
}: {
  tasks: NotificationTask[];
  handlingTaskId: string | null;
  feedback: { id: string; action: "snooze" | "complete" } | null;
  dismissingTaskId: string | null;
  error: string | null;
  onNavigate: () => void;
  onSnooze: (id: string) => void;
  onComplete: (id: string) => void;
}) {
  return (
    <div className="border-b border-amber-200/70 bg-amber-50/60 dark:border-amber-500/20 dark:bg-amber-500/[0.06]">
      <p className="flex items-center gap-1.5 px-4 pt-2.5 pb-1 text-[11px] font-semibold uppercase text-amber-700 dark:text-amber-300">
        <FileWarning className="h-3.5 w-3.5" /> Ação necessária para o cadastro
      </p>
      {error && <p className="px-4 py-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {tasks.map((task) => {
        const request = task.consultantRequest!;
        const busy = handlingTaskId === task.id;
        const taskFeedback = feedback?.id === task.id ? feedback.action : null;
        return (
          <div
            key={task.id}
            className={`border-t border-amber-200/50 px-4 py-3 transition duration-200 first:border-t-0 dark:border-amber-500/15 ${
              dismissingTaskId === task.id ? "translate-x-2 opacity-0" : "translate-x-0 opacity-100"
            }`}
          >
            <Link href={consultantRequestHref(task)} onClick={onNavigate} className="block min-w-0 hover:underline">
              <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{consultantRequestContact(task)}</p>
              <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-neutral-600 dark:text-neutral-300">{request.text}</p>
            </Link>
            <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
              {request.requestedBy} · {requestWhen(request.requestedAt)}
            </p>
            {taskFeedback ? (
              <p className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${taskFeedback === "complete" ? "text-emerald-700 dark:text-emerald-400" : "text-neutral-600 dark:text-neutral-300"}`}>
                {taskFeedback === "complete" ? <CircleCheck className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
                {taskFeedback === "complete" ? "Concluído" : "Lembrar em 1 hora"}
              </p>
            ) : (
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={() => onSnooze(task.id)} disabled={busy} className="btn-ghost text-xs">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock3 className="h-3.5 w-3.5" />}
                  Lembrar em 1h
                </button>
                <button type="button" onClick={() => onComplete(task.id)} disabled={busy} className="btn-ghost text-xs text-emerald-700 dark:text-emerald-400">
                  <CircleCheck className="h-3.5 w-3.5" /> Concluir
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Pedido de lead: aprovar reatribui o contato; recusar apenas encerra o pedido. */
function LeadRequestsGroup({
  requests,
  resolvingId,
  onResolve,
  onPreview,
}: {
  requests: LeadRequestNotification[];
  resolvingId: string | null;
  onResolve: (id: string, action: "approve" | "decline") => void;
  onPreview: (request: LeadRequestNotification) => void;
}) {
  return (
    <div className="border-b border-neutral-100 dark:border-neutral-800">
      <p className="px-4 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-brand uppercase">
        Pedidos de lead
      </p>
      {requests.map((r) => {
        const busy = resolvingId === r.id;
        return (
          <div key={r.id} className="flex items-start gap-2.5 px-4 py-2.5 text-sm">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-light dark:bg-[var(--brand-subtle)]">
              <UserPlus className="h-3 w-3 text-brand" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-neutral-700 dark:text-neutral-300">
                <span className="font-medium text-neutral-900 dark:text-neutral-100">{r.requester.name}</span> pediu{" "}
                <span className="font-medium text-neutral-900 dark:text-neutral-100">{r.contact.name}</span>{" "}
                {r.assignee && r.assignee.id !== r.requester.id ? (
                  <>
                    pra <span className="font-medium text-neutral-900 dark:text-neutral-100">{r.assignee.name}</span>
                  </>
                ) : (
                  "pra carteira dele"
                )}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onResolve(r.id, "approve")}
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500/15 dark:text-emerald-400 dark:hover:bg-emerald-500/25"
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.5} /> : <Check className="h-3 w-3" strokeWidth={2.5} />}
                  Aprovar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onResolve(r.id, "decline")}
                  className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
                >
                  <XIcon className="h-3 w-3" strokeWidth={2.5} />
                  Recusar
                </button>
                {/* Antes de decidir, dá pra abrir um popup com os dados do
                    cliente (pessoais + negócios) — pedido explícito, pensado
                    pra quem não lembra de cabeça quem é esse contato só
                    pelo nome. Não remove nem substitui Aprovar/Recusar
                    daqui: o popup também tem os dois botões, pra quem quiser
                    decidir na hora sem fechar. */}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPreview(r)}
                  className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-500 transition-colors hover:border-neutral-300 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-100"
                >
                  <Eye className="h-3 w-3" strokeWidth={2} />
                  Ver cliente
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Fila operacional do Administrativo: informa o que entrou, sem tratar a solicitacao como tarefa vencida. */
function QuotaRegistrationGroup({
  tasks,
  onNavigate,
}: {
  tasks: NotificationTask[];
  onNavigate: () => void;
}) {
  return (
    <div>
      <p className="px-4 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-brand uppercase">
        Cotas para cadastrar
      </p>
      {tasks.map((task) => {
        const registration = task.quotaRegistration!;
        const contactName = task.title.replace(/^Cadastrar cota:\s*/i, "");

        return (
          <Link
            key={task.id}
            href={task.deal ? `/cadastros/${task.deal.id}` : "/cadastros"}
            onClick={onNavigate}
            className="flex items-start gap-2.5 border-b border-neutral-50 px-4 py-2.5 text-sm last:border-0 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
          >
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-light dark:bg-[var(--brand-subtle)]">
              <ClipboardCheck className="h-3 w-3 text-brand" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">{contactName}</p>
              <p className="mt-0.5 truncate text-xs text-neutral-600 dark:text-neutral-300">
                Consultor: <span className="font-medium">{registration.consultant}</span>
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                <span className="font-medium tabular-nums text-neutral-700 dark:text-neutral-300">
                  {registration.value === null ? "Valor não informado" : formatCurrency(registration.value)}
                </span>
                <span>
                  Solicitada em{" "}
                  {new Date(registration.requestedAt).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "America/Campo_Grande",
                  })}
                </span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

const GROUP_TONE = {
  red: {
    label: "text-red-600 dark:text-red-400",
    iconBg: "bg-red-50 dark:bg-red-500/15",
    iconText: "text-red-600 dark:text-red-400",
    date: "text-red-600 dark:text-red-400",
  },
  amber: {
    label: "text-amber-600 dark:text-amber-400",
    iconBg: "bg-amber-50 dark:bg-amber-500/15",
    iconText: "text-amber-600 dark:text-amber-400",
    date: "text-amber-600 dark:text-amber-400",
  },
} as const;

/** Um grupo (Atrasadas ou Hoje) dentro do painel — mesmo mini-cabeçalho/tom de cor já usado nas seções da Agenda (ver tasks-list.tsx's TaskGroup). */
function NotificationGroup({
  label,
  tasks,
  tone,
  onNavigate,
}: {
  label: string;
  tasks: NotificationTask[];
  tone: "red" | "amber";
  onNavigate: () => void;
}) {
  const colors = GROUP_TONE[tone];
  return (
    <div>
      <p className={`px-4 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide uppercase ${colors.label}`}>{label}</p>
      {tasks.map((task) => {
        const Icon = TASK_TYPE_ICON[task.type] ?? TASK_TYPE_ICON.OTHER;
        const href = task.deal
          ? `/negocios/${task.deal.id}`
          : task.contact
            ? `/clientes/${task.contact.id}`
            : "/agenda";
        return (
          <Link
            key={task.id}
            href={href}
            onClick={onNavigate}
            className="flex items-start gap-2.5 border-b border-neutral-50 dark:border-neutral-800 px-4 py-2.5 text-sm last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${colors.iconBg}`}>
              <Icon className={`h-3 w-3 ${colors.iconText}`} strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">{task.title}</p>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {TASK_TYPE_LABELS[task.type] ?? task.type}
                {task.deal && ` · ${task.deal.name}`}
                {task.contact && ` · ${task.contact.name}`}
              </p>
              {task.dueAt && (
                <p className={`mt-0.5 text-xs ${colors.date}`}>{new Date(task.dueAt).toLocaleString("pt-BR")}</p>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
