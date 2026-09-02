"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Users, Kanban, Loader2 } from "lucide-react";
import { Modal } from "./modal";

const QUICK_LINKS = [
  { href: "/", label: "Início" },
  { href: "/clientes", label: "Clientes" },
  { href: "/negocios", label: "Negócios" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/whatsapp", label: "WhatsApp" },
  { href: "/agenda", label: "Agenda" },
  { href: "/relatorios", label: "Relatórios" },
  { href: "/configuracoes", label: "Configurações" },
];

type Result = {
  contacts: { id: string; name: string; email: string | null; whatsapp: string | null; ownerName: string | null }[];
  deals: {
    id: string;
    name: string;
    contact: { name: string };
    ownerName: string | null;
    status: "OPEN" | "WON" | "LOST";
  }[];
};

// Mesmo texto de deals-list.tsx/deal-detail.tsx (não centralizado — são só
// 3 valores, repetir aqui é mais simples que criar um módulo compartilhado
// só pra isto, mesmo padrão que o resto do código já segue).
const DEAL_STATUS_LABELS: Record<Result["deals"][number]["status"], string> = {
  OPEN: "Em andamento",
  WON: "Ganho",
  LOST: "Perdido",
};

export function CommandPalette({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result>({ contacts: [], deals: [] });
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults({ contacts: [], deals: [] });
      setSearching(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
      setResults({ contacts: [], deals: [] });
      setSearching(false);
      return;
    }
    // Liga o spinner já aqui (antes do debounce de 200ms), não só depois do
    // fetch — é o que faz o "instantâneo mas com aviso quando demora um
    // pouco" pedido: pra uma busca rápida o spinner mal pisca, mas se a
    // conexão/consulta atrasar ele fica visível o tempo todo, em vez de a
    // tela ficar "parada" sem indicar que algo está acontecendo.
    setSearching(true);
    let cancelled = false;
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setResults(data);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  const filteredLinks = QUICK_LINKS.filter((l) =>
    l.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const hasResults = filteredLinks.length > 0 || results.contacts.length > 0 || results.deals.length > 0;

  return (
    <>
      {compact ? (
        <button
          onClick={() => setOpen(true)}
          className="icon-btn"
          aria-label="Buscar"
        >
          <Search className="h-4 w-4" strokeWidth={2} />
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex h-9 w-48 shrink-0 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-400 shadow-sm transition-all duration-150 hover:border-neutral-300 hover:shadow dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-500 dark:hover:border-neutral-600"
        >
          <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <span className="flex-1 truncate text-left whitespace-nowrap">Buscar...</span>
          <kbd className="shrink-0 rounded border border-neutral-200 bg-neutral-50 px-1 py-0.5 font-mono text-[9px] font-medium text-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-500">
            ⌘K
          </kbd>
        </button>
      )}

      {open && (
        <Modal onClose={() => setOpen(false)} maxWidth="max-w-lg">
          <div className="flex items-center gap-2 border-b border-neutral-200 pb-3 dark:border-neutral-800">
            {searching ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-neutral-400" strokeWidth={2} />
            ) : (
              <Search className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={2} />
            )}
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar clientes, negócios..."
              className="w-full bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
            />
          </div>

          <div className="scrollbar-thin max-h-80 overflow-y-auto pt-2 pb-2">
            {!hasResults && searching && (
              <p className="flex items-center justify-center gap-2 px-1 py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                Buscando...
              </p>
            )}

            {!hasResults && !searching && (
              <p className="px-1 py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">
                Nada encontrado.
              </p>
            )}

            {filteredLinks.length > 0 && (
              <div className="pb-2">
                <p className="px-1 pb-1 text-[11px] font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
                  Navegar
                </p>
                {filteredLinks.map((l) => (
                  <button
                    key={l.href}
                    onClick={() => go(l.href)}
                    className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-neutral-800 transition-colors hover:bg-brand-light hover:text-brand dark:text-neutral-200 dark:hover:bg-brand-light dark:hover:text-brand"
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            )}

            {results.contacts.length > 0 && (
              <div className="pb-2">
                <p className="px-1 pb-1 text-[11px] font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
                  Clientes
                </p>
                {results.contacts.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => go(`/clientes/${c.id}`)}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-800 transition-colors hover:bg-brand-light hover:text-brand dark:text-neutral-200 dark:hover:bg-brand-light dark:hover:text-brand"
                  >
                    <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={2} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{c.name}</span>
                      {/* WhatsApp em linha própria, logo abaixo do nome — pedido
                          explícito: quando vários clientes têm o MESMO nome
                          (comum em bases grandes), o número é o jeito rápido de
                          saber qual é qual antes de abrir. Só aparece quando
                          o contato tem WhatsApp cadastrado — não força a linha
                          pra quem não tem. */}
                      {c.whatsapp && (
                        <span className="block truncate text-xs text-neutral-400 dark:text-neutral-500">{c.whatsapp}</span>
                      )}
                      <span className="block truncate text-xs text-neutral-400 dark:text-neutral-500">
                        {c.ownerName ? `Responsável: ${c.ownerName}` : "Sem responsável"}
                        {c.email && ` · ${c.email}`}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {results.deals.length > 0 && (
              <div>
                <p className="px-1 pb-1 text-[11px] font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
                  Negócios
                </p>
                {results.deals.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => go(`/negocios/${d.id}`)}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-800 transition-colors hover:bg-brand-light hover:text-brand dark:text-neutral-200 dark:hover:bg-brand-light dark:hover:text-brand"
                  >
                    <Kanban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={2} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{d.name}</span>
                      <span className="block truncate text-xs text-neutral-400 dark:text-neutral-500">
                        {d.contact.name}
                        {d.ownerName && ` · Responsável: ${d.ownerName}`}
                        {" · "}
                        {/* Status do negócio — pedido explícito: mostrar se
                            está em andamento, ganho ou perdido, sem tirar
                            nada que já tinha na linha. Ganho/Perdido em cor
                            pra bater o olho rápido; Em andamento (o estado
                            mais comum) fica na mesma cor neutra do resto. */}
                        <span
                          className={
                            d.status === "WON"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : d.status === "LOST"
                                ? "text-red-600 dark:text-red-400"
                                : ""
                          }
                        >
                          {DEAL_STATUS_LABELS[d.status]}
                        </span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
