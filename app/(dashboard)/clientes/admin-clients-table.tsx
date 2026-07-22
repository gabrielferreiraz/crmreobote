"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ChevronRight } from "lucide-react";
import { Avatar } from "@/components/avatar";

type ClientRow = {
  processId: string;
  contact: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
    jobTitle: string | null;
    source: string | null;
  };
  owner: { id: string; name: string };
  stage: { id: string; name: string; color: string | null };
  deal: { id: string; name: string };
};

export function AdminClientsTable({ clients }: { clients: ClientRow[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return clients;
    return clients.filter(
      (c) =>
        c.contact.name.toLowerCase().includes(term) ||
        c.owner.name.toLowerCase().includes(term) ||
        c.deal.name.toLowerCase().includes(term),
    );
  }, [clients, search]);

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
          strokeWidth={2}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por cliente ou responsável"
          className="field-input w-full py-1.5 pl-8 text-sm"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="card px-4 py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">
          Nenhum cliente encontrado.
        </div>
      ) : (
        <div className="card divide-y divide-neutral-100 overflow-hidden dark:divide-neutral-800">
          <div className="hidden gap-4 px-4 py-2.5 text-xs font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500 sm:grid sm:grid-cols-[1.5fr_1fr_1fr_1fr_auto]">
            <span>Cliente</span>
            <span>Contato</span>
            <span>Responsável</span>
            <span>Etapa</span>
            <span />
          </div>
          {filtered.map((c) => (
            <Link
              key={c.processId}
              href={`/processos/${c.processId}`}
              className="grid grid-cols-1 gap-2 px-4 py-3 text-sm transition-colors hover:bg-neutral-50 sm:grid-cols-[1.5fr_1fr_1fr_1fr_auto] sm:items-center dark:hover:bg-neutral-800/60"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">{c.contact.name}</p>
                <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{c.deal.name}</p>
              </div>
              <div className="min-w-0 truncate text-neutral-600 dark:text-neutral-300">
                {c.contact.whatsapp || c.contact.phone || c.contact.email || "—"}
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <Avatar name={c.owner.name} size="xs" />
                <span className="truncate text-neutral-700 dark:text-neutral-300">{c.owner.name}</span>
              </div>
              <div>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
                  style={{ borderColor: c.stage.color ?? "#999", color: c.stage.color ?? undefined }}
                >
                  {c.stage.name}
                </span>
              </div>
              <ChevronRight className="hidden h-4 w-4 shrink-0 text-neutral-300 sm:block dark:text-neutral-600" strokeWidth={2} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
