"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, Check, Loader2, Search } from "lucide-react";
import { Modal } from "@/components/modal";
import { TASK_TYPE_ICON, TASK_TYPE_LABELS } from "@/lib/task-icons";

type TaskType = "CALL" | "WHATSAPP" | "EMAIL" | "VIDEO_CALL" | "VISIT" | "PROPOSAL";
type DealOption = { id: string; title: string; contactName: string; ownerName: string };

const TYPES: TaskType[] = ["CALL", "WHATSAPP", "EMAIL", "VIDEO_CALL", "VISIT", "PROPOSAL"];

function tomorrowAtNine() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function BulkCreateTasksDialog({
  dealIds,
  onClose,
  onCreated,
}: {
  dealIds: string[];
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [deals, setDeals] = useState<DealOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(dealIds));
  const [scope, setScope] = useState<"all" | "custom">("all");
  const [type, setType] = useState<TaskType>("CALL");
  const [dueAt, setDueAt] = useState(tomorrowAtNine);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/tasks/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "preview", dealIds }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar os negócios.");
        setDeals(data.deals ?? []);
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Não foi possível carregar os negócios.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [dealIds]);

  const effectiveIds = scope === "all" ? deals.map((deal) => deal.id) : Array.from(selected);
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    if (!term) return deals;
    return deals.filter((deal) =>
      `${deal.contactName} ${deal.title} ${deal.ownerName}`.toLocaleLowerCase("pt-BR").includes(term),
    );
  }, [deals, query]);

  async function createTasks() {
    if (!dueAt || effectiveIds.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/tasks/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", dealIds: effectiveIds, type, dueAt }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Não foi possível marcar as tarefas.");
      await onCreated();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível marcar as tarefas.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-xl">
      <div className="space-y-5">
        <header className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <CalendarPlus className="h-4.5 w-4.5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Marcar tarefa</h2>
            <p className="text-sm text-neutral-500">Uma tarefa para cada negócio escolhido.</p>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {TYPES.map((value) => {
            const Icon = TASK_TYPE_ICON[value];
            const active = type === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setType(value)}
                className={`flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors ${
                  active
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200"
                    : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
                }`}
              >
                <Icon className="h-4 w-4" />
                {TASK_TYPE_LABELS[value]}
              </button>
            );
          })}
        </div>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Data e horário</span>
          <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="field-input" />
        </label>

        <div className="space-y-3">
          <div className="flex rounded-md bg-neutral-100 p-1 dark:bg-neutral-900">
            <button type="button" onClick={() => setScope("all")} className={`flex-1 rounded px-3 py-1.5 text-sm font-medium ${scope === "all" ? "bg-white shadow-sm dark:bg-neutral-800" : "text-neutral-500"}`}>
              Todos ({deals.length || dealIds.length})
            </button>
            <button type="button" onClick={() => setScope("custom")} className={`flex-1 rounded px-3 py-1.5 text-sm font-medium ${scope === "custom" ? "bg-white shadow-sm dark:bg-neutral-800" : "text-neutral-500"}`}>
              Escolher negócios
            </button>
          </div>

          {scope === "custom" && (
            <div className="overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800">
              <div className="relative border-b border-neutral-200 dark:border-neutral-800">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar negócio" className="h-10 w-full bg-transparent pl-9 pr-20 text-sm outline-none" />
                <button
                  type="button"
                  onClick={() => setSelected((current) => current.size === deals.length ? new Set() : new Set(deals.map((deal) => deal.id)))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                >
                  {selected.size === deals.length ? "Limpar" : "Todos"}
                </button>
              </div>
              <div className="scrollbar-thin max-h-52 overflow-y-auto">
                {loading ? (
                  <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-neutral-400" /></div>
                ) : filtered.map((deal) => {
                  const checked = selected.has(deal.id);
                  return (
                    <button
                      key={deal.id}
                      type="button"
                      onClick={() => setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(deal.id)) next.delete(deal.id); else next.add(deal.id);
                        return next;
                      })}
                      className="flex w-full items-center gap-3 border-b border-neutral-100 px-3 py-2.5 text-left last:border-0 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
                    >
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? "border-indigo-600 bg-indigo-600 text-white" : "border-neutral-300 dark:border-neutral-600"}`}>
                        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">{deal.contactName}</span>
                        <span className="block truncate text-xs text-neutral-500">{deal.title} · {deal.ownerName}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <footer className="flex items-center justify-between gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <span className="text-sm text-neutral-500">{effectiveIds.length} tarefa{effectiveIds.length === 1 ? "" : "s"}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancelar</button>
            <button type="button" onClick={createTasks} disabled={loading || saving || !dueAt || effectiveIds.length === 0} className="btn-primary">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Marcar tarefa
            </button>
          </div>
        </footer>
      </div>
    </Modal>
  );
}
