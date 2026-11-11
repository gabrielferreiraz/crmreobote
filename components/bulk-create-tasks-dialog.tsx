"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarPlus, Check, Loader2, Search, MessageCircle, ExternalLink } from "lucide-react";
import { Modal } from "@/components/modal";
import { TASK_TYPE_ICON, TASK_TYPE_LABELS } from "@/lib/task-icons";
import { renderSamplePreview } from "@/lib/campaigns/spintax";

type TaskType = "CALL" | "WHATSAPP" | "EMAIL" | "VIDEO_CALL" | "VISIT" | "PROPOSAL";
type DealOption = { id: string; title: string; contactName: string; ownerName: string };
type ScriptOption = { id: string; name: string; steps: { text: string; delayAfterSec: number; type?: "TEXT" | "IMAGE" | "VIDEO"; mediaUrl?: string }[] };
type CreateResult = { created: number; campaignId: string | null; queued: number; skippedNoPhone: number; skippedNoInstance: number; skippedDuplicateContact: number };

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
  const [scheduleMessage, setScheduleMessage] = useState(false);
  const [messageMode, setMessageMode] = useState<"script" | "custom">("script");
  const [scripts, setScripts] = useState<ScriptOption[] | null>(null);
  const [scriptId, setScriptId] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<CreateResult | null>(null);

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
  const selectedScript = scripts?.find((script) => script.id === scriptId);
  const previewText = messageMode === "script"
    ? selectedScript?.steps[0]?.text ?? ""
    : message;
  const canCreate = !scheduleMessage || (messageMode === "script" ? !!selectedScript : !!message.trim());

  useEffect(() => {
    if (!scheduleMessage || scripts !== null) return;
    const controller = new AbortController();
    fetch("/api/message-scripts", { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => []);
        if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar os scripts.");
        const available = Array.isArray(data) ? data as ScriptOption[] : [];
        setScripts(available);
        if (available.length) setScriptId(available[0].id);
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Não foi possível carregar os scripts.");
        setScripts([]);
      });
    return () => controller.abort();
  }, [scheduleMessage, scripts]);
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
        body: JSON.stringify({
          action: "create",
          dealIds: effectiveIds,
          type,
          dueAt,
          ...(scheduleMessage ? {
            whatsappCampaign: {
              scheduledAt: dueAt,
              ...(messageMode === "script" ? { scriptId } : { message }),
            },
          } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Não foi possível marcar as tarefas.");
      setResult(data as CreateResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível marcar as tarefas.");
    } finally {
      setSaving(false);
    }
  }

  function closeAfterCreate() {
    if (result) void onCreated();
    onClose();
  }

  return (
    <Modal onClose={result ? closeAfterCreate : onClose} maxWidth="max-w-xl">
      {result ? (
        <div className="space-y-4 py-2">
          <header className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
              <Check className="h-5 w-5" strokeWidth={2.5} />
            </span>
            <div>
              <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                {result.campaignId ? "Mensagens programadas" : "Tarefas criadas"}
              </h2>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                {result.created} tarefa{result.created === 1 ? "" : "s"} criada{result.created === 1 ? "" : "s"}
                {result.campaignId ? ` · ${result.queued} contato${result.queued === 1 ? "" : "s"} na campanha` : scheduleMessage ? " · nenhum contato tinha número e WhatsApp conectado" : ""}.
              </p>
              {result.campaignId && <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Para ver os detalhes, abra a campanha em Campanhas no WhatsApp.</p>}
            </div>
          </header>
          {result.campaignId && (
            <Link href={`/whatsapp/campanhas/${result.campaignId}`} onClick={closeAfterCreate} className="btn-primary w-full justify-center">
              Abrir esta campanha
              <ExternalLink className="h-4 w-4" />
            </Link>
          )}
          {(result.skippedNoPhone > 0 || result.skippedNoInstance > 0 || result.skippedDuplicateContact > 0) && (
            <p className="text-xs text-neutral-500">
              Ignorados: {[
                result.skippedNoPhone ? `${result.skippedNoPhone} sem telefone` : null,
                result.skippedNoInstance ? `${result.skippedNoInstance} sem WhatsApp conectado` : null,
                result.skippedDuplicateContact ? `${result.skippedDuplicateContact} duplicados` : null,
              ].filter(Boolean).join(" · ")}.
            </p>
          )}
          <div className="flex justify-end">
            <button type="button" onClick={closeAfterCreate} className="btn-ghost">Fechar</button>
          </div>
        </div>
      ) : (
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

        {type === "WHATSAPP" && (
          <section className="space-y-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
            <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-neutral-800 dark:text-neutral-200">
              <input type="checkbox" checked={scheduleMessage} onChange={(event) => setScheduleMessage(event.target.checked)} className="accent-indigo-600" />
              Programar mensagem junto com a tarefa
            </label>
            {scheduleMessage && (
              <div className="space-y-3 pl-6">
                <div className="flex gap-1 rounded-md bg-neutral-100 p-1 dark:bg-neutral-900">
                  <button type="button" onClick={() => setMessageMode("script")} className={`flex-1 rounded px-3 py-1.5 text-sm font-medium ${messageMode === "script" ? "bg-white shadow-sm dark:bg-neutral-800" : "text-neutral-500"}`}>Script salvo</button>
                  <button type="button" onClick={() => setMessageMode("custom")} className={`flex-1 rounded px-3 py-1.5 text-sm font-medium ${messageMode === "custom" ? "bg-white shadow-sm dark:bg-neutral-800" : "text-neutral-500"}`}>Escrever mensagem</button>
                </div>
                {messageMode === "script" ? (
                  scripts === null ? (
                    <p className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" />Carregando scripts...</p>
                  ) : scripts.length ? (
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Script</span>
                      <select value={scriptId} onChange={(event) => setScriptId(event.target.value)} className="field-input">
                        {scripts.map((script) => <option key={script.id} value={script.id}>{script.name}</option>)}
                      </select>
                    </label>
                  ) : <p className="text-sm text-neutral-500">Nenhum script disponível. Escreva uma mensagem para continuar.</p>
                ) : (
                  <div className="space-y-2">
                    <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={4} maxLength={10000} placeholder="Escreva a mensagem para os negócios selecionados" className="field-input" />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 text-xs text-neutral-500">Inserir variável:</span>
                      {["{nome}", "{primeiro_nome}", "{cargo}", "{empresa}", "{cidade}", "{consultor}", "{saudacao}"].map((variable) => (
                        <button key={variable} type="button" onClick={() => setMessage((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}${variable}`)} className="rounded border border-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">{variable}</button>
                      ))}
                    </div>
                  </div>
                )}
                {previewText && (
                  <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
                    <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-neutral-500"><MessageCircle className="h-3.5 w-3.5" />Prévia · Maria Silva</p>
                    <p className="whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-200">{renderSamplePreview(previewText)}</p>
                    {messageMode === "script" && (selectedScript?.steps.length ?? 0) > 1 && <p className="mt-1 text-xs text-neutral-500">+ {selectedScript!.steps.length - 1} mensagens no fluxo</p>}
                  </div>
                )}
                <p className="text-xs text-neutral-500">A campanha começa no horário acima e envia aos poucos, respeitando o intervalo, os dias e o horário permitido para campanhas.</p>
              </div>
            )}
          </section>
        )}

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
            <button type="button" onClick={createTasks} disabled={loading || saving || !dueAt || effectiveIds.length === 0 || !canCreate || (scheduleMessage && messageMode === "script" && scripts === null)} className="btn-primary">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {scheduleMessage ? "Programar e marcar tarefa" : "Marcar tarefa"}
            </button>
          </div>
        </footer>
      </div>
      )}
    </Modal>
  );
}
