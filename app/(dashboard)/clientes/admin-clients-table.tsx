"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ChevronRight } from "lucide-react";
import { Avatar } from "@/components/avatar";

export type ClientRow = {
  /** id do cliente (contato): uma linha por cliente. */
  key: string;
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
  /** null quando o cliente entrou direto num Processo, sem negócio ganho neste CRM. */
  deal: { id: string; name: string } | null;
  /** Quantas vendas ganhas o cliente tem (a linha mostra a mais recente). */
  dealsCount: number;
  wonAt: string | null;
  /** Etapa do Processo, ou a situação do cadastro da cota quando ainda não há Processo. */
  badge: { label: string; color: string | null };
  href: string;
};

const PAGE = 200;

const digits = (v: string | null) => (v ?? "").replace(/\D/g, "");

export function AdminClientsTable({ clients }: { clients: ClientRow[] }) {
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(PAGE);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return clients;
    const termDigits = digits(term);
    return clients.filter(
      (c) =>
        c.contact.name.toLowerCase().includes(term) ||
        c.owner.name.toLowerCase().includes(term) ||
        (c.deal?.name.toLowerCase().includes(term) ?? false) ||
        (c.contact.email ?? "").toLowerCase().includes(term) ||
        (termDigits.length >= 4 && (digits(c.contact.whatsapp).includes(termDigits) || digits(c.contact.phone).includes(termDigits))),
    );
  }, [clients, search]);

  const shown = filtered.slice(0, visible);

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
          strokeWidth={2}
        />
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setVisible(PAGE);
          }}
          placeholder="Buscar por cliente, telefone, e-mail ou responsável"
          className="field-input w-full py-1.5 pl-8 text-sm"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="card px-4 py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">Nenhum cliente encontrado.</div>
      ) : (
        <div className="card divide-y divide-neutral-100 overflow-hidden dark:divide-neutral-800">
          <div className="hidden gap-4 px-4 py-2.5 text-xs font-medium tracking-wide text-neutral-400 uppercase sm:grid sm:grid-cols-[1.5fr_1fr_1fr_1fr_auto] dark:text-neutral-500">
            <span>Cliente</span>
            <span>Contato</span>
            <span>Responsável</span>
            <span>Situação</span>
            <span />
          </div>
          {shown.map((c) => (
            <Link
              key={c.key}
              href={c.href}
              className="grid grid-cols-1 gap-2 px-4 py-3 text-sm transition-colors hover:bg-neutral-50 sm:grid-cols-[1.5fr_1fr_1fr_1fr_auto] sm:items-center dark:hover:bg-neutral-800/60"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">{c.contact.name}</p>
                {(c.deal || c.wonAt) && (
                  <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                    {[
                      c.deal?.name,
                      c.dealsCount > 1 ? `${c.dealsCount} vendas` : null,
                      c.wonAt ? `ganho em ${new Date(c.wonAt).toLocaleDateString("pt-BR", { timeZone: "America/Campo_Grande" })}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
              <div className="min-w-0 truncate text-neutral-600 dark:text-neutral-300">{c.contact.whatsapp || c.contact.phone || c.contact.email || "—"}</div>
              <div className="flex min-w-0 items-center gap-2">
                <Avatar name={c.owner.name} size="xs" />
                <span className="truncate text-neutral-700 dark:text-neutral-300">{c.owner.name}</span>
              </div>
              <div>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
                  style={{ borderColor: c.badge.color ?? "#999", color: c.badge.color ?? undefined }}
                >
                  {c.badge.label}
                </span>
              </div>
              <ChevronRight className="hidden h-4 w-4 shrink-0 text-neutral-300 sm:block dark:text-neutral-600" strokeWidth={2} />
            </Link>
          ))}
        </div>
      )}

      {filtered.length > shown.length && (
        <div className="flex justify-center">
          <button type="button" onClick={() => setVisible((n) => n + PAGE)} className="btn-secondary">
            Mostrar mais ({filtered.length - shown.length} restantes)
          </button>
        </div>
      )}
    </div>
  );
}
