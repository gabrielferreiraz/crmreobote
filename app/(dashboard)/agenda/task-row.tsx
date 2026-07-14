"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleAlert, ChevronDown, CalendarPlus } from "lucide-react";
import { TASK_TYPE_LABELS, TASK_TYPE_ICON, TASK_TYPE_COLOR } from "@/lib/task-icons";
import { Avatar } from "@/components/avatar";
import { AnimatedCheck } from "@/components/animated-check";
import { buildGoogleCalendarUrl } from "@/lib/google-calendar";

export type Task = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  dueAt: string | Date | null;
  completedAt: string | Date | null;
  deal: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  owner: { id: string; name: string; photoUrl: string | null };
};

export function TaskRow({
  task,
  onToggle,
  muted,
  showOwner,
}: {
  task: Task;
  onToggle: (id: string, completed: boolean) => void;
  muted?: boolean;
  showOwner?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [completed, setCompleted] = useState(!!task.completedAt);
  const [justCompleted, setJustCompleted] = useState(false);
  const Icon = TASK_TYPE_ICON[task.type] ?? TASK_TYPE_ICON.OTHER;
  const color = TASK_TYPE_COLOR[task.type] ?? TASK_TYPE_COLOR.OTHER;
  const overdue = !completed && !!task.dueAt && new Date(task.dueAt) < new Date();
  const hasDetails = !!task.description || !!task.deal || !!task.contact;

  useEffect(() => {
    setCompleted(!!task.completedAt);
  }, [task.completedAt]);

  function handleToggle(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !completed;
    setCompleted(next);
    if (next) {
      setJustCompleted(true);
      setTimeout(() => setJustCompleted(false), 500);
    }
    onToggle(task.id, next);
  }

  return (
    <div className={`card text-sm ${muted ? "opacity-60" : ""}`}>
      <div
        className={`flex items-center gap-3 p-3 ${hasDetails ? "cursor-pointer" : ""}`}
        onClick={() => hasDetails && setExpanded((v) => !v)}
      >
        <button
          type="button"
          onClick={handleToggle}
          className="tap-target max-lg:-m-2 shrink-0"
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

        <span
          className={`min-w-0 flex-1 truncate ${
            completed ? "text-neutral-400 line-through dark:text-neutral-500" : "text-neutral-900 dark:text-neutral-100"
          }`}
        >
          {task.title}
        </span>

        <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline-block ${color.bg} ${color.text}`}>
          {TASK_TYPE_LABELS[task.type] ?? task.type}
        </span>

        {showOwner && (
          <span className="shrink-0">
            <Avatar name={task.owner.name} src={task.owner.photoUrl} size="xs" />
          </span>
        )}

        {task.dueAt && (
          <span
            className={`shrink-0 text-xs whitespace-nowrap ${
              overdue ? "font-medium text-red-600 dark:text-red-400" : "text-neutral-400 dark:text-neutral-500"
            }`}
          >
            {new Date(task.dueAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}

        {task.dueAt && (
          <a
            href={buildGoogleCalendarUrl({ title: task.title, description: task.description, start: task.dueAt })}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="icon-btn shrink-0"
            aria-label="Adicionar ao Google Agenda"
            title="Adicionar ao Google Agenda"
          >
            <CalendarPlus className="h-3.5 w-3.5" strokeWidth={2} />
          </a>
        )}

        {hasDetails && (
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-neutral-300 transition-transform dark:text-neutral-600 ${expanded ? "rotate-180" : ""}`}
            strokeWidth={2}
          />
        )}
      </div>

      {hasDetails && (
        <div
          className="grid transition-all duration-200 ease-out"
          style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            <div className="space-y-1.5 px-3 pt-0 pb-3 pl-[42px] text-xs text-neutral-500 dark:text-neutral-400">
              {task.description && <p>{task.description}</p>}
              {(task.deal || task.contact) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {task.deal && (
                    <Link
                      href={`/negocios/${task.deal.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:text-neutral-900 hover:underline dark:hover:text-neutral-100"
                    >
                      {task.deal.name}
                    </Link>
                  )}
                  {task.contact && (
                    <Link
                      href={`/clientes/${task.contact.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:text-neutral-900 hover:underline dark:hover:text-neutral-100"
                    >
                      {task.contact.name}
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
