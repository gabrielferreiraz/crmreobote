"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X, Undo2, Loader2, History } from "lucide-react";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";

type UndoActionEntry = {
  id: string;
  description: string;
  actorName: string;
  undoneAt: string | null;
  createdAt: string;
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
}

export function UndoHistoryView({ initialActions }: { initialActions: UndoActionEntry[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Busca inteiramente client-side sobre as últimas 200 já carregadas —
  // mesmo padrão de configuracoes/auditoria/audit-log-view.tsx.
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return initialActions;
    return initialActions.filter(
      (a) => a.description.toLowerCase().includes(term) || a.actorName.toLowerCase().includes(term),
    );
  }, [initialActions, search]);

  async function handleUndo(id: string) {
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/undo/${id}`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Não foi possível desfazer essa ação.");
        return;
      }
      router.refresh();
    } catch {
      setError("Falha de conexão ao desfazer.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" strokeWidth={2} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por descrição ou pessoa"
          className="field-input w-full py-1.5 pr-8 pl-8 text-sm"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute top-1/2 right-2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">{error}</p>
      )}

      {filtered.length === 0 ? (
        <div className="card">
          <EmptyState icon={History} title="Nada por aqui ainda" description="Exclusões, edições e movimentações que você fizer aparecem nesta lista." />
        </div>
      ) : (
        <div className="card divide-y divide-neutral-100 dark:divide-neutral-800">
          {filtered.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  {a.undoneAt && <Badge tone="neutral">Desfeita</Badge>}
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">{a.description}</span>
                </div>
                <p className="text-xs text-neutral-400 dark:text-neutral-500">
                  {a.actorName} · {formatDateTime(a.createdAt)}
                </p>
              </div>
              {!a.undoneAt && (
                <button
                  type="button"
                  onClick={() => handleUndo(a.id)}
                  disabled={pendingId === a.id}
                  className="btn-secondary btn-sm shrink-0"
                >
                  {pendingId === a.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
                  ) : (
                    <Undo2 className="h-3.5 w-3.5" strokeWidth={2} />
                  )}
                  Desfazer
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
