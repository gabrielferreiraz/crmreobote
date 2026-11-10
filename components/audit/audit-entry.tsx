"use client";

import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { Badge } from "@/components/badge";
import { actionLabel, actionTone, categoryLabel, categoryOf, targetHref } from "@/lib/audit-meta";
import type { AuditEntry } from "@/lib/audit-query";

const TZ = "America/Campo_Grande";

export function formatAuditDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** "há 5 min", "ontem 14:30" — para ler rápido; a data completa fica no detalhe. */
export function formatAuditWhen(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const diff = now - d.getTime();
  if (diff >= 0 && diff < 60_000) return "agora";
  if (diff >= 0 && diff < 3_600_000) return `há ${Math.floor(diff / 60_000)} min`;
  const day = (x: Date) => x.toLocaleDateString("pt-BR", { timeZone: TZ });
  const time = d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  if (day(d) === day(new Date(now))) return `hoje ${time}`;
  if (day(d) === day(new Date(now - 86_400_000))) return `ontem ${time}`;
  return `${d.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "2-digit" })} ${time}`;
}

function ChangeRows({ entry }: { entry: AuditEntry }) {
  if (entry.changes.length === 0) return null;
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700">
      <table className="w-full text-left text-xs">
        <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400">
          <tr>
            <th className="px-2.5 py-1.5 font-medium">Campo</th>
            <th className="px-2.5 py-1.5 font-medium">Antes</th>
            <th className="w-6" aria-hidden="true" />
            <th className="px-2.5 py-1.5 font-medium">Depois</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {entry.changes.map((c) => (
            <tr key={c.field}>
              <td className="px-2.5 py-1.5 font-medium text-neutral-700 dark:text-neutral-200">{c.label}</td>
              <td className="px-2.5 py-1.5 text-red-700 dark:text-red-400">{c.from ?? <span className="italic text-neutral-400">vazio</span>}</td>
              <td className="text-neutral-300">
                <ArrowRight className="h-3 w-3" />
              </td>
              <td className="px-2.5 py-1.5 text-emerald-700 dark:text-emerald-400">{c.to ?? <span className="italic text-neutral-400">vazio</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Um evento da trilha: quem fez, quando, o que fez e (quando existe) o antes → depois.
 * `compact` esconde o item auditado (usado no histórico de UMA venda, onde ele já é óbvio).
 */
export function AuditEntryCard({ entry, compact = false, onFilterTarget }: { entry: AuditEntry; compact?: boolean; onFilterTarget?: (e: AuditEntry) => void }) {
  const href = targetHref(entry.targetType, entry.targetId);
  const hasDetail = Boolean(entry.detail) && entry.changes.length === 0;
  return (
    <article className="p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone={actionTone(entry.action)}>{actionLabel(entry.action)}</Badge>
          <span className="font-medium text-neutral-900 dark:text-neutral-100">{entry.actorName}</span>
          {!compact && entry.targetLabel && (
            <span className="text-neutral-500 dark:text-neutral-400">
              em{" "}
              {href ? (
                <Link href={href} className="font-medium text-brand hover:underline">
                  {entry.targetLabel}
                </Link>
              ) : (
                <span className="font-medium text-neutral-700 dark:text-neutral-200">{entry.targetLabel}</span>
              )}
            </span>
          )}
        </div>
        <time dateTime={entry.createdAt} title={formatAuditDateTime(entry.createdAt)} className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
          {formatAuditWhen(entry.createdAt)}
        </time>
      </div>

      {hasDetail && <p className="mt-1 text-neutral-600 dark:text-neutral-300">{entry.detail}</p>}
      <ChangeRows entry={entry} />

      <details className="group mt-1.5">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300">
          <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" /> Detalhes do registro
        </summary>
        <dl className="mt-1.5 grid gap-x-4 gap-y-1 rounded-lg bg-neutral-50 p-2.5 text-xs sm:grid-cols-[120px_1fr] dark:bg-neutral-800/50">
          <dt className="text-neutral-500">Data e hora</dt>
          <dd className="text-neutral-800 dark:text-neutral-200">{formatAuditDateTime(entry.createdAt)} (Campo Grande)</dd>
          <dt className="text-neutral-500">Quem fez</dt>
          <dd className="text-neutral-800 dark:text-neutral-200">
            {entry.actorName}
            {entry.actorUserId ? "" : " (pessoa removida do sistema)"}
          </dd>
          <dt className="text-neutral-500">Área do sistema</dt>
          <dd className="text-neutral-800 dark:text-neutral-200">{categoryLabel(categoryOf(entry.action))}</dd>
          {entry.targetLabel || entry.targetId ? (
            <>
              <dt className="text-neutral-500">Item</dt>
              <dd className="break-all text-neutral-800 dark:text-neutral-200">
                {entry.targetLabel ?? "—"}
                {entry.targetType ? ` · ${entry.targetType}` : ""}
                {entry.targetId ? <span className="font-mono text-neutral-400"> · {entry.targetId}</span> : null}
                {onFilterTarget && entry.targetId && (
                  <button type="button" onClick={() => onFilterTarget(entry)} className="ml-2 font-medium text-brand hover:underline">
                    Ver tudo deste item
                  </button>
                )}
              </dd>
            </>
          ) : null}
          {entry.detail && entry.changes.length > 0 && (
            <>
              <dt className="text-neutral-500">Resumo</dt>
              <dd className="text-neutral-800 dark:text-neutral-200">{entry.detail}</dd>
            </>
          )}
          {entry.ip && (
            <>
              <dt className="text-neutral-500">IP</dt>
              <dd className="font-mono text-neutral-800 dark:text-neutral-200">{entry.ip}</dd>
            </>
          )}
          <dt className="text-neutral-500">Código</dt>
          <dd className="font-mono text-neutral-400">{entry.id}</dd>
        </dl>
      </details>
    </article>
  );
}
