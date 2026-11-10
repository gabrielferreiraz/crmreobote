"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, History, Loader2, X } from "lucide-react";
import { AuditEntryCard } from "@/components/audit/audit-entry";
import { Modal } from "@/components/modal";
import { actionLabel, actionTone } from "@/lib/audit-meta";
import type { AuditEntry } from "@/lib/audit-query";
import { formatAuditDateTime, formatAuditWhen } from "@/components/audit/audit-entry";

const RECENT_LIMIT = 4;
const REFRESH_INTERVAL_MS = 30_000;

const TONE_CLASS = {
  neutral: "bg-neutral-400",
  success: "bg-emerald-500",
  danger: "bg-red-500",
  warning: "bg-amber-500",
} as const;

function RecentAuditEntry({ entry }: { entry: AuditEntry }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_CLASS[actionTone(entry.action)]}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-neutral-800 dark:text-neutral-200">
          <span className="font-medium">{actionLabel(entry.action)}</span>
          <span className="text-neutral-500 dark:text-neutral-400"> por {entry.actorName}</span>
        </p>
        {entry.detail && <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{entry.detail}</p>}
      </div>
      <time dateTime={entry.createdAt} title={formatAuditDateTime(entry.createdAt)} className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
        {formatAuditWhen(entry.createdAt)}
      </time>
    </div>
  );
}

/**
 * Histórico de auditoria de UMA venda: tudo que foi feito no cadastro, na cota,
 * nos documentos e nos pedidos — quem fez, quando e o que mudou.
 */
export function AuditTimeline({ dealId, reloadKey = 0 }: { dealId: string; reloadKey?: number }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(
    async (after?: string) => {
      const res = await fetch(`/api/deals/${dealId}/audit${after ? `?cursor=${encodeURIComponent(after)}` : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Não foi possível carregar o histórico.");
      return (await res.json()) as { entries: AuditEntry[]; nextCursor: string | null };
    },
    [dealId],
  );

  useEffect(() => {
    let cancelled = false;
    load()
      .then((r) => {
        if (cancelled) return;
        setEntries(r.entries);
        setCursor(r.nextCursor);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [load, reloadKey]);

  useEffect(() => {
    if (showAll) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      load()
        .then((result) => {
          setEntries(result.entries);
          setCursor(result.nextCursor);
          setError(null);
        })
        .catch(() => {});
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [load, showAll]);

  async function more() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const r = await load(cursor);
      setEntries((prev) => [...(prev ?? []), ...r.entries]);
      setCursor(r.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  const recentEntries = useMemo(() => {
    const seen = new Set<string>();
    const recent: AuditEntry[] = [];
    for (const entry of entries ?? []) {
      const key = `${entry.action}|${entry.actorName}|${entry.detail ?? ""}|${JSON.stringify(entry.changes)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      recent.push(entry);
      if (recent.length === RECENT_LIMIT) break;
    }
    return recent;
  }, [entries]);

  if (error && !entries) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!entries) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-neutral-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando o histórico…
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 py-6 text-center">
        <History className="h-5 w-5 text-neutral-400" />
        <p className="text-sm text-neutral-600 dark:text-neutral-300">Nada registrado nesta venda ainda.</p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">Cada alteração a partir de agora aparece aqui, com quem fez e quando.</p>
      </div>
    );
  }

  return (
    <>
      <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {recentEntries.map((entry) => (
          <RecentAuditEntry key={entry.id} entry={entry} />
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-2 flex justify-end border-t border-neutral-100 pt-2 dark:border-neutral-800">
        <button type="button" onClick={() => setShowAll(true)} className="btn-ghost text-xs">
          Ver mais
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      {showAll && (
        <Modal onClose={() => setShowAll(false)} maxWidth="max-w-3xl">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Histórico completo</h2>
              <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">Ações dos usuários nesta venda, da mais recente para a mais antiga.</p>
            </div>
            <button type="button" onClick={() => setShowAll(false)} className="icon-btn -mt-1 -mr-1 h-8 w-8 shrink-0" aria-label="Fechar histórico">
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          <div className="divide-y divide-neutral-100 overflow-hidden rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {entries.map((entry) => (
              <AuditEntryCard key={entry.id} entry={entry} compact />
            ))}
          </div>
          {cursor && (
            <div className="mt-3 flex justify-center">
              <button type="button" onClick={() => void more()} disabled={loadingMore} className="btn-secondary btn-sm">
                {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Mostrar ações mais antigas
              </button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
