"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Search, ShieldAlert, X } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { AuditEntryCard } from "@/components/audit/audit-entry";
import { ACTION_LABELS, AUDIT_CATEGORIES, categoryOf } from "@/lib/audit-meta";
import type { AuditEntry, AuditFilters } from "@/lib/audit-query";

type Page = { entries: AuditEntry[]; nextCursor: string | null };

const EMPTY: AuditFilters = {};

function toQuery(filters: AuditFilters, extra: Record<string, string | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...filters, ...extra })) if (v) p.set(k, v);
  return p.toString();
}

export function AuditLogView({
  initial,
  actors,
  initialFilters = EMPTY,
}: {
  initial: Page;
  actors: { id: string | null; name: string }[];
  initialFilters?: AuditFilters;
}) {
  const [filters, setFilters] = useState<AuditFilters>(initialFilters);
  const [text, setText] = useState(initialFilters.q ?? "");
  const [entries, setEntries] = useState(initial.entries);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetName, setTargetName] = useState<string | null>(null);
  const requestId = useRef(0);
  const firstRun = useRef(true);

  const set = useCallback(<K extends keyof AuditFilters>(key: K, value: AuditFilters[K]) => {
    setFilters((f) => ({ ...f, [key]: value || undefined }));
  }, []);

  // Busca por texto com um respiro: não consulta a cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === (text.trim() || undefined) ? f : { ...f, q: text.trim() || undefined })), 350);
    return () => clearTimeout(t);
  }, [text]);

  // Qualquer filtro novo refaz a lista do começo (a primeira carga já veio do servidor).
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    fetch(`/api/audit?${toQuery(filters)}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Não foi possível carregar a auditoria.");
        return (await res.json()) as Page;
      })
      .then((page) => {
        if (id !== requestId.current) return;
        setEntries(page.entries);
        setCursor(page.nextCursor);
      })
      .catch((e: Error) => id === requestId.current && setError(e.message))
      .finally(() => id === requestId.current && setLoading(false));
  }, [filters]);

  async function loadMore() {
    if (!cursor) return;
    const id = requestId.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/audit?${toQuery(filters, { cursor })}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Não foi possível carregar mais eventos.");
      const page = (await res.json()) as Page;
      if (id !== requestId.current) return;
      setEntries((prev) => [...prev, ...page.entries]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const actionOptions = useMemo(
    () =>
      Object.entries(ACTION_LABELS)
        .filter(([action]) => !filters.category || filters.category === categoryOf(action))
        .sort((a, b) => a[1].localeCompare(b[1], "pt-BR")),
    [filters.category],
  );

  const active = Object.entries(filters).filter(([k, v]) => v && k !== "q").length + (filters.q ? 1 : 0);
  const exportHref = `/api/audit/export?${toQuery(filters)}`;

  function clearAll() {
    setFilters({});
    setText("");
    setTargetName(null);
  }

  return (
    <div className="space-y-3">
      <div className="card space-y-3 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" strokeWidth={2} />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Buscar por pessoa, cliente, detalhe, IP ou tipo de ação"
            className="field-input w-full py-1.5 pr-8 pl-8 text-sm"
            aria-label="Buscar na auditoria"
          />
          {text && (
            <button type="button" onClick={() => setText("")} className="absolute top-1/2 right-2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600" aria-label="Limpar busca">
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <label className="space-y-1 text-xs text-neutral-500">
            De
            <input type="date" className="field-input w-full py-1.5 text-sm" value={filters.from ?? ""} max={filters.to || undefined} onChange={(e) => set("from", e.target.value)} />
          </label>
          <label className="space-y-1 text-xs text-neutral-500">
            Até
            <input type="date" className="field-input w-full py-1.5 text-sm" value={filters.to ?? ""} min={filters.from || undefined} onChange={(e) => set("to", e.target.value)} />
          </label>
          <label className="space-y-1 text-xs text-neutral-500">
            Pessoa
            <select className="field-input w-full py-1.5 text-sm" value={filters.actorId ?? ""} onChange={(e) => set("actorId", e.target.value)}>
              <option value="">Todas</option>
              {actors
                .filter((a) => a.id)
                .map((a) => (
                  <option key={a.id} value={a.id!}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-neutral-500">
            Área do sistema
            <select
              className="field-input w-full py-1.5 text-sm"
              value={filters.category ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value || undefined, action: undefined }))}
            >
              <option value="">Todas</option>
              {AUDIT_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
              <option value="outros">Outros</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-neutral-500">
            Ação
            <select className="field-input w-full py-1.5 text-sm" value={filters.action ?? ""} onChange={(e) => set("action", e.target.value)}>
              <option value="">Todas</option>
              {actionOptions.map(([action, label]) => (
                <option key={action} value={action}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {filters.targetId && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-light px-2.5 py-1 font-medium text-brand">
              Só este item{targetName ? `: ${targetName}` : ""}
              <button type="button" onClick={() => { set("targetId", ""); set("targetType", ""); setTargetName(null); }} aria-label="Tirar o filtro de item">
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {active > 0 && (
            <button type="button" onClick={clearAll} className="text-neutral-500 underline-offset-2 hover:underline">
              Limpar filtros ({active})
            </button>
          )}
          <span className="ml-auto flex items-center gap-3 text-neutral-500 dark:text-neutral-400">
            <span>
              {entries.length}
              {cursor ? "+" : ""} {entries.length === 1 ? "evento" : "eventos"}
            </span>
            <a href={exportHref} className="inline-flex items-center gap-1 font-medium text-brand hover:underline" title="Baixa em CSV tudo o que bate com os filtros (a exportação também fica registrada)">
              <Download className="h-3.5 w-3.5" /> Exportar CSV
            </a>
          </span>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

      {entries.length === 0 && !loading ? (
        <div className="card">
          <EmptyState icon={ShieldAlert} title="Nenhum evento encontrado" description={active > 0 ? "Tente tirar algum filtro." : undefined} />
        </div>
      ) : (
        <div className={`card divide-y divide-neutral-100 dark:divide-neutral-800 ${loading ? "opacity-60" : ""}`}>
          {entries.map((e) => (
            <AuditEntryCard
              key={e.id}
              entry={e}
              onFilterTarget={(x) => {
                setFilters((f) => ({ ...f, targetType: x.targetType ?? undefined, targetId: x.targetId ?? undefined }));
                setTargetName(x.targetLabel);
              }}
            />
          ))}
        </div>
      )}

      {cursor && (
        <div className="flex justify-center">
          <button type="button" onClick={() => void loadMore()} disabled={loading} className="btn-secondary">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Mostrar mais antigos
          </button>
        </div>
      )}
    </div>
  );
}
