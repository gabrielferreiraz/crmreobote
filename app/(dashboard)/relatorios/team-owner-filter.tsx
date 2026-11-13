"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, Search, UserRound, UsersRound } from "lucide-react";
import { useFloatingDropdown } from "@/lib/use-floating-dropdown";
import { MAX_REPORT_PEOPLE_FILTERS, normalizeReportPeople } from "@/lib/reports/people-filter";
import { sortSelfFirst } from "@/lib/sort-self-first";
import { sortAlpha } from "@/lib/sort-alpha";
import { WHO_FILTER_KEY } from "./filters-storage";

/**
 * Filtro combinado por equipes e consultores. `who` se repete na URL e o
 * servidor une os membros de todas as escolhas. As opções já chegam limitadas
 * ao escopo visível; selecionar aqui apenas estreita esse escopo.
 */
export function TeamOwnerFilter({
  teams,
  members,
  currentUserId,
  multiple = false,
}: {
  teams: { id: string; name: string }[];
  members: { id: string; name: string }[];
  /** Para "Eu" aparecer sempre em primeiro (ver lib/sort-self-first.ts). */
  currentUserId?: string;
  /** O relatório administrativo ainda usa a seleção simples. */
  multiple?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const orderedTeams = sortAlpha(teams, (team) => team.name);
  const orderedMembers = sortSelfFirst(sortAlpha(members, (member) => member.name), currentUserId);
  const validValues = new Set([
    ...orderedTeams.map((team) => `team:${team.id}`),
    ...orderedMembers.map((member) => `owner:${member.id}`),
  ]);
  const selectedValues = normalizeReportPeople(searchParams.getAll("who")).filter((value) => validValues.has(value));
  const selected = multiple ? selectedValues : selectedValues.slice(0, 1);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(selected);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const coords = useFloatingDropdown({ open, onClose: () => setOpen(false), triggerRef, panelRef, align: "left" });

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- abre refletindo a URL atual
    setDraft(selected);
    setSearch("");
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
    // A URL não deve apagar escolhas ainda não aplicadas enquanto o painel está aberto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (teams.length === 0 && members.length <= 1) return null;

  function apply(values: string[]) {
    const next = multiple ? normalizeReportPeople(values) : normalizeReportPeople(values).slice(0, 1);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("who");
    for (const value of next) params.append("who", value);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
    try {
      if (next.length > 0) localStorage.setItem(WHO_FILTER_KEY, JSON.stringify(next));
      else localStorage.removeItem(WHO_FILTER_KEY);
    } catch {}
    setOpen(false);
  }

  function toggle(value: string) {
    if (!multiple) {
      apply([value]);
      return;
    }
    setDraft((current) => {
      if (current.includes(value)) return current.filter((item) => item !== value);
      return current.length >= MAX_REPORT_PEOPLE_FILTERS ? current : [...current, value];
    });
  }

  const labels = new Map<string, string>([
    ...orderedTeams.map((team) => [`team:${team.id}`, team.name] as const),
    ...orderedMembers.map((member) => [`owner:${member.id}`, member.id === currentUserId ? "Eu" : member.name] as const),
  ]);
  const teamCount = selected.filter((value) => value.startsWith("team:")).length;
  const ownerCount = selected.length - teamCount;
  const label =
    selected.length === 0
      ? "Todo o time"
      : selected.length === 1
        ? labels.get(selected[0]) ?? "1 seleção"
        : teamCount > 0 && ownerCount > 0
          ? `${teamCount} ${teamCount === 1 ? "equipe" : "equipes"} + ${ownerCount} ${ownerCount === 1 ? "consultor" : "consultores"}`
          : teamCount > 0
            ? `${teamCount} equipes`
            : `${ownerCount} consultores`;

  const foldedSearch = fold(search);
  const visibleTeams = orderedTeams.filter((team) => fold(team.name).includes(foldedSearch));
  const visibleMembers = orderedMembers.filter((member) =>
    fold(member.id === currentUserId ? `Eu ${member.name}` : member.name).includes(foldedSearch),
  );
  const changed = draft.length !== selected.length || draft.some((value) => !selected.includes(value));
  const atLimit = draft.length >= MAX_REPORT_PEOPLE_FILTERS;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="true"
        aria-expanded={open}
        title={selected.length > 1 ? selected.map((value) => labels.get(value)).filter(Boolean).join(", ") : undefined}
        className={`field-input flex w-full items-center gap-1.5 text-left text-sm sm:w-64 ${
          open ? "border-neutral-400 ring-1 ring-neutral-400 dark:border-neutral-500 dark:ring-neutral-500" : ""
        } ${selected.length > 0 ? "border-neutral-900 dark:border-neutral-100" : ""}`}
      >
        <UsersRound className="h-3.5 w-3.5 shrink-0 opacity-50" strokeWidth={2} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {selected.length > 1 && (
          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-neutral-900 px-1.5 text-[11px] font-semibold text-white dark:bg-white dark:text-neutral-900">
            {selected.length}
          </span>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform duration-200 dark:text-neutral-500 ${open ? "rotate-180" : ""}`}
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
              width: 336,
              maxWidth: `calc(100vw - ${(coords.left ?? 0) + 16}px)`,
              maxHeight: Math.min(480, coords.maxHeight),
            }}
            className="surface-glass-filter animate-pop-in fixed z-40 flex flex-col overflow-hidden rounded-lg shadow-xl"
          >
            <div className="border-b border-neutral-200/70 px-3 py-2.5 dark:border-neutral-700/70">
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Equipes e consultores</p>
            </div>
            <div className="relative shrink-0 border-b border-neutral-200/70 p-1.5 dark:border-neutral-700/70">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" strokeWidth={2} />
              <input
                ref={searchRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar equipe ou consultor"
                aria-label="Buscar equipe ou consultor"
                className="w-full rounded bg-transparent py-1.5 pr-2 pl-8 text-sm text-neutral-800 outline-none placeholder:text-neutral-400 dark:text-neutral-200 dark:placeholder:text-neutral-500"
              />
            </div>

            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1.5">
              {visibleTeams.length > 0 && (
                <FilterSection title="Equipes" icon={<UsersRound className="h-3.5 w-3.5" strokeWidth={2} />}>
                  {visibleTeams.map((team) => (
                    <FilterOption
                      key={team.id}
                      label={team.name}
                      checked={draft.includes(`team:${team.id}`)}
                      disabled={!draft.includes(`team:${team.id}`) && atLimit}
                      onClick={() => toggle(`team:${team.id}`)}
                    />
                  ))}
                </FilterSection>
              )}
              {visibleMembers.length > 0 && (
                <FilterSection title="Consultores" icon={<UserRound className="h-3.5 w-3.5" strokeWidth={2} />}>
                  {visibleMembers.map((member) => (
                    <FilterOption
                      key={member.id}
                      label={member.id === currentUserId ? `Eu · ${member.name}` : member.name}
                      checked={draft.includes(`owner:${member.id}`)}
                      disabled={!draft.includes(`owner:${member.id}`) && atLimit}
                      onClick={() => toggle(`owner:${member.id}`)}
                    />
                  ))}
                </FilterSection>
              )}
              {visibleTeams.length === 0 && visibleMembers.length === 0 && (
                <p className="px-2 py-4 text-center text-sm text-neutral-500 dark:text-neutral-400">Nenhum resultado</p>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-neutral-200/70 p-2 dark:border-neutral-700/70">
              <button
                type="button"
                onClick={() => (multiple ? setDraft([]) : apply([]))}
                disabled={selected.length === 0 && draft.length === 0}
                className="btn-ghost btn-sm disabled:opacity-40"
              >
                Limpar
              </button>
              {multiple && (
                <button type="button" onClick={() => apply(draft)} disabled={!changed} className="btn-primary btn-sm">
                  Aplicar{draft.length > 0 ? ` (${draft.length})` : ""}
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase();
}

function FilterSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-2 last:mb-0">
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold tracking-[0.08em] text-neutral-400 uppercase dark:text-neutral-500">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

function FilterOption({
  label,
  checked,
  disabled,
  onClick,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        checked
          ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
          : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800/60"
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          checked
            ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
            : "border-neutral-300 dark:border-neutral-600"
        }`}
      >
        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
