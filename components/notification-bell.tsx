"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, BellOff, Loader2, UserPlus, Check, X as XIcon, Eye } from "lucide-react";
import { TASK_TYPE_LABELS, TASK_TYPE_ICON } from "@/lib/task-icons";
import { usePushSubscription } from "@/lib/use-push-subscription";
import { LeadRequestContactModal } from "@/components/lead-request-contact-modal";

type NotificationTask = {
  id: string;
  type: string;
  title: string;
  dueAt: string | null;
  deal: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
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

const POLL_INTERVAL_MS = 60_000;

export function NotificationBell() {
  const [tasks, setTasks] = useState<NotificationTask[]>([]);
  const [leadRequests, setLeadRequests] = useState<LeadRequestNotification[]>([]);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Pedido de lead que está aberto no popup "Ver cliente" (ver
  // LeadRequestContactModal) — guarda o request inteiro, não só o
  // contactId, porque o popup também precisa saber PRA QUAL pedido
  // aprovar/recusar (o mesmo botão do popup resolve o pedido certo).
  const [previewRequest, setPreviewRequest] = useState<LeadRequestNotification | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { status: pushStatus, loading: pushLoading, subscribe, unsubscribe } = usePushSubscription();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [tasksRes, leadRequestsRes] = await Promise.all([
        fetch("/api/tasks/notifications"),
        fetch("/api/lead-requests"),
      ]);
      if (!cancelled && tasksRes.ok) setTasks(await tasksRes.json());
      if (!cancelled && leadRequestsRes.ok) setLeadRequests(await leadRequestsRes.json());
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

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
        setLeadRequests((prev) => prev.filter((r) => r.id !== id));
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
  // Atrasadas primeiro (mais urgente), depois as de hoje ainda não vencidas
  // — os dois grupos já vêm ordenados por dueAt crescente (ver a query),
  // então só filtrar preserva a ordem cronológica dentro de cada um.
  const overdueTasks = tasks.filter((t) => t.overdue);
  const todayTasks = tasks.filter((t) => !t.overdue);
  const totalCount = tasks.length + leadRequests.length;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notificações"
        className="icon-btn relative h-9 w-9"
      >
        <Bell className="h-4 w-4" strokeWidth={2} />
        {totalCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold leading-none text-white">
            {totalCount > 9 ? "9+" : totalCount}
          </span>
        )}
      </button>

      {open && (
        <div className="surface-glass-panel animate-pop-in absolute right-0 z-40 mt-2 w-80 rounded-lg">
          <div className="border-b border-neutral-100 dark:border-neutral-800 px-4 py-2.5">
            <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
              Tarefas atrasadas/hoje
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
              href="/agenda"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:underline"
            >
              Ver agenda completa
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

/** "Fulano pediu Beltrano pra carteira dele" — aprovar reatribui o contato na hora (ver PATCH /api/lead-requests/[id]); recusar só fecha o pedido; "Ver cliente" abre o popup de consulta (ver LeadRequestContactModal) antes de decidir. */
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
