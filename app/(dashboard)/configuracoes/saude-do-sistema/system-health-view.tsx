"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, HelpCircle, ChevronDown, ChevronUp, Zap, Webhook } from "lucide-react";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";

export type CronRunEntry = {
  id: string;
  name: string;
  startedAt: Date;
  finishedAt: Date | null;
  success: boolean;
  detail: string | null;
};

export type CronStatus = {
  name: string;
  label: string;
  lastRun: CronRunEntry | null;
};

export type AutomationFailure = {
  id: string;
  ruleName: string;
  createdAt: Date;
  detail: string | null;
};

export type WebhookFailure = {
  id: string;
  url: string;
  event: string;
  createdAt: Date;
  responseStatus: number | null;
  responseBody: string | null;
};

/** "há 3min" / "há 2h" / "há 5d" — granularidade fina de propósito, cron roda a cada 1-2min, "dias" sozinho não diria nada útil sobre atraso recente. */
function timeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min}min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

function formatDateTime(date: Date): string {
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function SystemHealthView({
  cronStatuses,
  recentRuns,
  automationFailures,
  webhookFailures,
}: {
  cronStatuses: CronStatus[];
  recentRuns: CronRunEntry[];
  automationFailures: AutomationFailure[];
  webhookFailures: WebhookFailure[];
}) {
  const [showHistory, setShowHistory] = useState(false);
  const cronLabelByName = new Map(cronStatuses.map((c) => [c.name, c.label]));

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xs font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
          Crons — última execução
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {cronStatuses.map((cron) => (
            <CronStatusCard key={cron.name} cron={cron} />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-neutral-400 uppercase hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
        >
          Histórico de execuções (últimas {recentRuns.length})
          {showHistory ? <ChevronUp className="h-3.5 w-3.5" strokeWidth={2} /> : <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />}
        </button>
        {showHistory && (
          <div className="card scrollbar-thin max-h-80 overflow-y-auto">
            {recentRuns.length === 0 ? (
              <p className="p-4 text-sm text-neutral-400 dark:text-neutral-500">Nenhum cron rodou ainda.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {recentRuns.map((run) => (
                    <tr key={run.id} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {run.success ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" strokeWidth={2} />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-red-500" strokeWidth={2} />
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-neutral-700 dark:text-neutral-300">
                        {cronLabelByName.get(run.name) ?? run.name}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-neutral-400 dark:text-neutral-500">
                        {formatDateTime(run.startedAt)}
                      </td>
                      <td className="max-w-xs truncate px-3 py-2 text-neutral-500 dark:text-neutral-400" title={run.detail ?? undefined}>
                        {run.detail ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
          Falhas recentes de automações
        </h2>
        {automationFailures.length === 0 ? (
          <div className="card">
            <EmptyState icon={Zap} title="Nenhuma falha recente" description="Toda automação executada recentemente funcionou." />
          </div>
        ) : (
          <div className="card divide-y divide-neutral-100 dark:divide-neutral-800">
            {automationFailures.map((f) => (
              <div key={f.id} className="flex items-start gap-3 p-3 text-sm">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" strokeWidth={2} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-neutral-800 dark:text-neutral-200">{f.ruleName}</p>
                  <p className="mt-0.5 text-neutral-500 dark:text-neutral-400">{f.detail ?? "Sem detalhe"}</p>
                </div>
                <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">{timeAgo(f.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
          Falhas recentes de webhooks
        </h2>
        {webhookFailures.length === 0 ? (
          <div className="card">
            <EmptyState icon={Webhook} title="Nenhuma falha recente" description="Toda entrega de webhook recente foi bem-sucedida." />
          </div>
        ) : (
          <div className="card divide-y divide-neutral-100 dark:divide-neutral-800">
            {webhookFailures.map((f) => (
              <div key={f.id} className="flex items-start gap-3 p-3 text-sm">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" strokeWidth={2} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-neutral-800 dark:text-neutral-200">
                    {f.event} <span className="font-normal text-neutral-400 dark:text-neutral-500">→ {f.url}</span>
                  </p>
                  <p className="mt-0.5 truncate text-neutral-500 dark:text-neutral-400">
                    {f.responseStatus ? `HTTP ${f.responseStatus} — ` : ""}
                    {f.responseBody ?? "Sem detalhe"}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">{timeAgo(f.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CronStatusCard({ cron }: { cron: CronStatus }) {
  const { label, lastRun } = cron;
  return (
    <div className="card flex items-center gap-3 p-3">
      {lastRun === null ? (
        <HelpCircle className="h-5 w-5 shrink-0 text-neutral-300 dark:text-neutral-600" strokeWidth={2} />
      ) : lastRun.success ? (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" strokeWidth={2} />
      ) : (
        <XCircle className="h-5 w-5 shrink-0 text-red-500" strokeWidth={2} />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-neutral-900 dark:text-neutral-100">{label}</p>
        {lastRun === null ? (
          <p className="text-xs text-neutral-400 dark:text-neutral-500">Nunca rodou</p>
        ) : (
          <p className="truncate text-xs text-neutral-400 dark:text-neutral-500" title={lastRun.detail ?? undefined}>
            {timeAgo(lastRun.startedAt)}
            {!lastRun.success && lastRun.detail ? ` — ${lastRun.detail}` : ""}
          </p>
        )}
      </div>
      {lastRun && (
        <Badge tone={lastRun.success ? "success" : "danger"} size="sm" className="shrink-0">
          {lastRun.success ? "OK" : "Falhou"}
        </Badge>
      )}
    </div>
  );
}
