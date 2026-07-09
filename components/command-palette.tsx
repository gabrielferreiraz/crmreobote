"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Users, Kanban } from "lucide-react";
import { Modal } from "./modal";

const QUICK_LINKS = [
  { href: "/", label: "Início" },
  { href: "/clientes", label: "Clientes" },
  { href: "/negocios", label: "Negócios" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/agenda", label: "Agenda" },
  { href: "/relatorios", label: "Relatórios" },
  { href: "/automacoes", label: "Automações" },
  { href: "/configuracoes", label: "Configurações" },
];

type Result = {
  contacts: { id: string; name: string; email: string | null }[];
  deals: { id: string; name: string; contact: { name: string } }[];
};

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result>({ contacts: [], deals: [] });
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
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
      setResults({ contacts: [], deals: [] });
      return;
    }
    let cancelled = false;
    const timeout = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!res.ok || cancelled) return;
      const data = await res.json();
      if (!cancelled) setResults(data);
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
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 w-64 shrink-0 items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-400 transition-colors hover:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-500 dark:hover:border-neutral-600"
      >
        <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        <span className="flex-1 truncate text-left whitespace-nowrap">Buscar clientes, negócios...</span>
        <kbd className="shrink-0 rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-500">
          ⌘K
        </kbd>
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)} maxWidth="max-w-lg">
          <div className="flex items-center gap-2 border-b border-neutral-200 pb-3 dark:border-neutral-800">
            <Search className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={2} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar clientes, negócios..."
              className="w-full bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
            />
          </div>

          <div className="scrollbar-thin max-h-80 overflow-y-auto pt-2">
            {!hasResults && (
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
                    className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-neutral-800 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
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
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-800 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  >
                    <Users className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={2} />
                    <span className="truncate">{c.name}</span>
                    {c.email && <span className="truncate text-neutral-400">{c.email}</span>}
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
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-800 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  >
                    <Kanban className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={2} />
                    <span className="truncate">{d.name}</span>
                    <span className="truncate text-neutral-400">{d.contact.name}</span>
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
