"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Check, ChevronDown, Search, Tag } from "lucide-react";
import { useFloatingDropdown } from "@/lib/use-floating-dropdown";
import { MAX_REPORT_TAGS, normalizeReportTags } from "@/lib/reports/tags";
import { TAGS_FILTER_KEY } from "./filters-storage";

// ─── Lista de tags da organização ─────────────────────────────────────
// Buscada UMA vez (ao passar o mouse/abrir) e guardada no módulo: reabrir o
// filtro, ou trocar de período, não refaz a ida ao servidor. A rota já tem o
// próprio cache de 1 min no servidor (ver getDistinctContactTags).
const TAGS_TTL_MS = 60_000;
let tagsCache: { at: number; tags: string[] } | null = null;
let tagsInFlight: Promise<string[]> | null = null;

function loadTagOptions(): Promise<string[]> {
  if (tagsCache && Date.now() - tagsCache.at < TAGS_TTL_MS) return Promise.resolve(tagsCache.tags);
  if (tagsInFlight) return tagsInFlight;
  tagsInFlight = fetch("/api/contacts/tag-options")
    .then(async (res) => {
      if (!res.ok) throw new Error("tags");
      const data = (await res.json()) as { tags?: string[] };
      const tags = Array.isArray(data.tags) ? data.tags : [];
      tagsCache = { at: Date.now(), tags };
      return tags;
    })
    .finally(() => {
      tagsInFlight = null;
    });
  return tagsInFlight;
}

/** Minúsculo + sem acento, só pra COMPARAR na busca (nunca pra exibir). */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/**
 * Filtro de tags do relatório — o negócio entra se o CONTATO dele tem
 * QUALQUER UMA das tags escolhidas. A escolha fica num rascunho dentro do
 * painel e só vale no "Aplicar": cada aplicação refaz o relatório inteiro no
 * servidor, então marcar 3 tags não pode virar 3 recargas.
 *
 * Mesmo desenho dos outros filtros: a URL é a fonte da verdade (`tag`
 * repetido, ver lib/reports/tags.ts) e o localStorage só restaura a URL
 * quando ela chega em branco (ver filters-url-restore.tsx).
 */
export function TagsFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selected = normalizeReportTags(searchParams.getAll("tag"));

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(selected);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<string[] | null>(tagsCache?.tags ?? null);
  const [failed, setFailed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const coords = useFloatingDropdown({ open, onClose: () => setOpen(false), triggerRef, panelRef, align: "left" });

  function fetchOptions() {
    setFailed(false);
    loadTagOptions()
      .then(setOptions)
      .catch(() => setFailed(true));
  }

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- painel acabou de abrir: começa do que está na URL
    setDraft(selected);
    setSearch("");
    if (!options) fetchOptions();
    const raf = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(raf);
    // Só quando o painel ABRE — reagir a `options`/URL com ele aberto apagaria a escolha em andamento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function apply(next: string[]) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tag");
    for (const tag of next) params.append("tag", tag);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    try {
      if (next.length > 0) localStorage.setItem(TAGS_FILTER_KEY, JSON.stringify(next));
      else localStorage.removeItem(TAGS_FILTER_KEY);
    } catch {}
    setOpen(false);
  }

  function toggle(tag: string) {
    setDraft((prev) => {
      if (prev.includes(tag)) return prev.filter((t) => t !== tag);
      return prev.length >= MAX_REPORT_TAGS ? prev : [...prev, tag];
    });
  }

  // Uma tag já escolhida que sumiu da lista (ex.: nenhum contato visível pra
  // este usuário tem mais ela) continua aparecendo, pra dar pra desmarcar.
  const allOptions = Array.from(new Set([...(options ?? []), ...selected])).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const query = fold(search.trim());
  const visible = query ? allOptions.filter((t) => fold(t).includes(query)) : allOptions;
  const atLimit = draft.length >= MAX_REPORT_TAGS;
  const changed = draft.length !== selected.length || draft.some((t) => !selected.includes(t));

  const label = selected.length === 0 ? "Todas as tags" : selected.length === 1 ? selected[0] : `${selected.length} tags`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        // Passar o mouse já busca a lista — ao clicar ela costuma estar pronta.
        onMouseEnter={() => {
          if (!options) fetchOptions();
        }}
        onFocus={() => {
          if (!options) fetchOptions();
        }}
        aria-haspopup="true"
        aria-expanded={open}
        title={selected.length > 1 ? selected.join(", ") : undefined}
        // w-full abaixo de sm: preenche a célula da grade de 2 colunas do celular (ver relatorios/page.tsx).
        className={`field-input flex w-full items-center gap-1.5 text-left text-sm sm:w-52 ${
          open ? "border-neutral-400 ring-1 ring-neutral-400 dark:border-neutral-500 dark:ring-neutral-500" : ""
        } ${selected.length > 0 ? "border-neutral-900 dark:border-neutral-100" : ""}`}
      >
        <Tag className="h-3.5 w-3.5 shrink-0 opacity-50" strokeWidth={2} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform duration-200 ease-smooth dark:text-neutral-500 ${open ? "rotate-180" : ""}`}
          strokeWidth={2}
        />
      </button>

      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              top: coords.top,
              bottom: coords.bottom,
              left: coords.left,
              width: 288,
              maxWidth: `calc(100vw - ${(coords.left ?? 0) + 16}px)`,
              maxHeight: Math.min(420, coords.maxHeight),
            }}
            className="surface-glass-filter animate-pop-in fixed z-40 flex flex-col overflow-hidden rounded-lg shadow-xl"
          >
            <div className="relative shrink-0 border-b border-neutral-200/70 p-1 dark:border-neutral-700/70">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar tag..."
                aria-label="Buscar tag"
                className="w-full rounded bg-transparent py-1.5 pr-2 pl-8 text-sm text-neutral-800 outline-none placeholder:text-neutral-400 dark:text-neutral-200 dark:placeholder:text-neutral-500"
              />
            </div>

            <div role="group" aria-label="Tags" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1">
              {options === null && !failed ? (
                <p className="px-2.5 py-2 text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>
              ) : failed && options === null ? (
                <div className="space-y-1 px-2.5 py-2">
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">Não foi possível carregar as tags.</p>
                  <button type="button" onClick={fetchOptions} className="text-sm font-medium text-brand hover:underline">
                    Tentar de novo
                  </button>
                </div>
              ) : visible.length === 0 ? (
                <p className="px-2.5 py-2 text-sm text-neutral-400 dark:text-neutral-500">{allOptions.length === 0 ? "Nenhuma tag cadastrada" : "Nenhum resultado"}</p>
              ) : (
                visible.map((tag) => {
                  const checked = draft.includes(tag);
                  const blocked = !checked && atLimit;
                  return (
                    <button
                      key={tag}
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      disabled={blocked}
                      onClick={() => toggle(tag)}
                      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        checked
                          ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                          : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800/60"
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          checked ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900" : "border-neutral-300 dark:border-neutral-600"
                        }`}
                      >
                        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{tag}</span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="shrink-0 space-y-2 border-t border-neutral-200/70 p-2 dark:border-neutral-700/70">
              <p className="px-1 text-xs text-neutral-500 dark:text-neutral-400">
                {atLimit ? `Máximo de ${MAX_REPORT_TAGS} tags.` : "Negócios cujo contato tem qualquer uma delas."}
              </p>
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => apply([])} disabled={selected.length === 0 && draft.length === 0} className="btn-ghost btn-sm disabled:opacity-40">
                  Limpar
                </button>
                <button type="button" onClick={() => apply(draft)} disabled={!changed} className="btn-primary btn-sm">
                  Aplicar{draft.length > 0 ? ` (${draft.length})` : ""}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
