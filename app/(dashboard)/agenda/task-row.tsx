"use client";

import { useEffect, useState } from "react";
import { CircleAlert, ChevronRight, CalendarPlus } from "lucide-react";
import { TASK_TYPE_LABELS, TASK_TYPE_ICON, TASK_TYPE_COLOR } from "@/lib/task-icons";
import { Avatar } from "@/components/avatar";
import { AnimatedCheck } from "@/components/animated-check";
import { buildGoogleCalendarUrl } from "@/lib/google-calendar";
import { TaskDetailModal } from "./task-detail-modal";

export type Task = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  dueAt: string | Date | null;
  completedAt: string | Date | null;
  createdAt: string | Date;
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
  } | null;
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
  const [modalOpen, setModalOpen] = useState(false);
  const [completed, setCompleted] = useState(!!task.completedAt);
  const [justCompleted, setJustCompleted] = useState(false);
  const Icon = TASK_TYPE_ICON[task.type] ?? TASK_TYPE_ICON.OTHER;
  const color = TASK_TYPE_COLOR[task.type] ?? TASK_TYPE_COLOR.OTHER;
  const overdue = !completed && !!task.dueAt && new Date(task.dueAt) < new Date();

  useEffect(() => {
    setCompleted(!!task.completedAt);
  }, [task.completedAt]);

  function handleToggle(e?: React.MouseEvent) {
    e?.stopPropagation();
    const next = !completed;
    setCompleted(next);
    if (next) {
      setJustCompleted(true);
      setTimeout(() => setJustCompleted(false), 500);
    }
    onToggle(task.id, next);
  }

  return (
    <>
      <div className={`card text-sm ${muted ? "opacity-60" : ""}`}>
        <div
          className="flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/50 rounded-lg"
          onClick={() => setModalOpen(true)}
        >
          {/* Status icon — clicável independente pra toggle */}
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
              className={`shrink-0 whitespace-nowrap text-xs ${
                overdue ? "font-medium text-red-600 dark:text-red-400" : "text-neutral-400 dark:text-neutral-500"
              }`}
            >
              {new Date(task.dueAt).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}

          {task.dueAt && (
            <a
              href={buildGoogleCalendarUrl({ title: task.title, description: task.description, start: task.dueAt })}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 px-2 py-1 text-2xs font-bold border border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 rounded transition-colors shrink-0"
              title="Adicionar ao Google Agenda"
            >
              <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="4" width="18" height="17" rx="2" fill="#4285F4"/>
                <path d="M3 6c0-1.1.9-2 2-2h14c1.1 0 2 .9 2 2v3H3V6z" fill="#34A853"/>
                <rect x="6" y="9" width="12" height="9" rx="1" fill="white"/>
                <text x="12" y="16" fill="#4285F4" font-family="sans-serif" font-size="8" font-weight="bold" text-anchor="middle">31</text>
              </svg>
              <span className="hidden sm:inline">Google Agenda</span>
            </a>
          )}

          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-300 dark:text-neutral-600" strokeWidth={2} />
        </div>

        {/* Sub-info compacta visível na linha */}
        {(task.deal || task.contact) && (
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 pb-2.5 pl-[42px] text-xs text-neutral-500 dark:text-neutral-400 cursor-pointer"
            onClick={() => setModalOpen(true)}
          >
            {task.deal && <span>{task.deal.name}</span>}
            {task.contact && <span>{task.contact.name}</span>}
          </div>
        )}
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
        />
      )}
    </>
  );
}
