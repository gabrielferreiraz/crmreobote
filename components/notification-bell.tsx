"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { TASK_TYPE_LABELS, TASK_TYPE_ICON } from "@/lib/task-icons";
import { usePushSubscription } from "@/lib/use-push-subscription";

type NotificationTask = {
  id: string;
  type: string;
  title: string;
  dueAt: string | null;
  deal: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
};

const POLL_INTERVAL_MS = 60_000;

export function NotificationBell() {
  const [tasks, setTasks] = useState<NotificationTask[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { status: pushStatus, loading: pushLoading, subscribe, unsubscribe } = usePushSubscription();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const res = await fetch("/api/tasks/notifications");
      if (!res.ok || cancelled) return;
      const data = await res.json();
      if (!cancelled) setTasks(data);
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

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

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notificações"
        className="icon-btn relative h-9 w-9"
      >
        <Bell className="h-4 w-4" strokeWidth={2} />
        {tasks.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
            {tasks.length > 9 ? "9+" : tasks.length}
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
          <div className="scrollbar-thin max-h-96 overflow-y-auto">
            {tasks.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">
                Nenhuma tarefa pendente.
              </p>
            ) : (
              tasks.map((task) => {
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
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2.5 border-b border-neutral-50 dark:border-neutral-800 px-4 py-2.5 text-sm last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  >
                    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-50 dark:bg-red-500/15">
                      <Icon className="h-3 w-3 text-red-600 dark:text-red-400" strokeWidth={2} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">{task.title}</p>
                      <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                        {TASK_TYPE_LABELS[task.type] ?? task.type}
                        {task.deal && ` · ${task.deal.name}`}
                        {task.contact && ` · ${task.contact.name}`}
                      </p>
                      {task.dueAt && (
                        <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">
                          {new Date(task.dueAt).toLocaleString("pt-BR")}
                        </p>
                      )}
                    </div>
                  </Link>
                );
              })
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
    </div>
  );
}
