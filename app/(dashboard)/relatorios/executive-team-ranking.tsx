"use client";

import { forwardRef, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Trophy, UsersRound, X } from "lucide-react";
import type { ExecutiveReportData } from "@/lib/reports/executive-data";
import { formatExecutiveCurrency } from "@/lib/reports/executive-utils";

type Team = ExecutiveReportData["teams"][number];
type TeamMonth = ExecutiveReportData["teamMonths"][number];
type AnchorRect = { top: number; right: number; bottom: number; left: number; width: number; height: number };
type ActiveTeam = { team: Team; anchor: AnchorRect; pinned: boolean };

const TOOLTIP_ID = "executive-team-ranking-popover";

export function ExecutiveTeamRanking({
  teams,
  months,
  exactValues,
}: {
  teams: ExecutiveReportData["teams"];
  months: ExecutiveReportData["teamMonths"];
  exactValues: boolean;
}) {
  const [active, setActive] = useState<ActiveTeam | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const maxTeamTotal = Math.max(1, ...teams.map((team) => team.total));
  const money = (value: number) => formatExecutiveCurrency(value, exactValues);

  const cancelClose = () => {
    if (closeTimer.current === null) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  const showTeam = (team: Team, element: HTMLElement, pinned: boolean) => {
    cancelClose();
    const rect = element.getBoundingClientRect();
    setActive({
      team,
      pinned,
      anchor: {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      },
    });
  };

  const showFromPointer = (team: Team, event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse") return;
    cancelClose();
    const rect = event.currentTarget.getBoundingClientRect();
    const anchor = {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    };
    setActive((current) => {
      if (current?.pinned && current.team.name === team.name) return current;
      return {
        team,
        pinned: false,
        anchor,
      };
    });
  };

  const scheduleClose = () => {
    if (active?.pinned) return;
    cancelClose();
    closeTimer.current = setTimeout(() => setActive(null), 140);
  };

  const togglePinned = (team: Team, element: HTMLElement) => {
    if (active?.pinned && active.team.name === team.name) {
      setActive(null);
      return;
    }
    showTeam(team, element, true);
  };

  useEffect(() => () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => {
    if (!active) return;

    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-executive-team-trigger]") || popoverRef.current?.contains(target)) return;
      setActive(null);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setActive(null);
    };
    const closeOnViewportChange = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && popoverRef.current?.contains(target)) return;
      setActive(null);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [active]);

  return (
    <>
      <div className="mt-5 divide-y divide-neutral-200 lg:hidden dark:divide-neutral-800">
        {teams.map((team) => (
          <button
            key={team.name}
            type="button"
            data-executive-team-trigger
            onClick={(event) => togglePinned(team, event.currentTarget)}
            aria-expanded={active?.team.name === team.name && active.pinned}
            aria-describedby={active?.team.name === team.name ? TOOLTIP_ID : undefined}
            className="block w-full py-4 text-left outline-none first:pt-0 last:pb-0 focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="min-w-0 truncate text-lg font-semibold text-neutral-900 dark:text-neutral-100">{team.name}</h3>
              <span className="shrink-0 text-lg font-semibold tabular-nums text-neutral-950 dark:text-white">{money(team.total)}</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {team.values.map((value, index) => (
                <div key={months[index] ? `${months[index].year}-${months[index].month}` : index}>
                  <p className="text-sm capitalize text-neutral-400 dark:text-neutral-500">{months[index]?.label}</p>
                  <p className="mt-0.5 text-base font-medium tabular-nums text-neutral-700 dark:text-neutral-300">{money(value)}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(4, (team.total / maxTeamTotal) * 100)}%` }} />
            </div>
          </button>
        ))}
      </div>

      <div className="mt-5 hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[520px] text-base">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
              <th className="pb-2 font-medium">Equipe</th>
              {months.map((month) => (
                <th key={`${month.year}-${month.month}`} className="pb-2 text-right font-medium capitalize">{month.label}</th>
              ))}
              <th className="pb-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr
                key={team.name}
                tabIndex={0}
                data-executive-team-trigger
                onPointerEnter={(event) => showFromPointer(team, event)}
                onPointerLeave={scheduleClose}
                onFocus={(event) => showTeam(team, event.currentTarget, false)}
                onBlur={scheduleClose}
                onClick={(event) => togglePinned(team, event.currentTarget)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  togglePinned(team, event.currentTarget);
                }}
                aria-expanded={active?.team.name === team.name && active.pinned}
                aria-describedby={active?.team.name === team.name ? TOOLTIP_ID : undefined}
                className="group cursor-pointer border-b border-neutral-100 outline-none transition-colors hover:bg-violet-50/60 focus-visible:bg-violet-50/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 last:border-0 dark:border-neutral-900 dark:hover:bg-violet-950/20 dark:focus-visible:bg-violet-950/20"
              >
                <td className="py-3 font-medium text-neutral-900 transition-colors group-hover:text-violet-700 dark:text-neutral-100 dark:group-hover:text-violet-300">{team.name}</td>
                {team.values.map((value, index) => (
                  <td key={index} className="py-3 text-right tabular-nums text-neutral-600 dark:text-neutral-300">{money(value)}</td>
                ))}
                <td className="py-3 text-right">
                  <div className="ml-auto w-28">
                    <span className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{money(team.total)}</span>
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                      <span
                        className="block h-full rounded-full bg-violet-500 transition-[width] duration-500"
                        style={{ width: `${Math.max(4, (team.total / maxTeamTotal) * 100)}%` }}
                      />
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {active && typeof document !== "undefined" && createPortal(
        <TeamPopover
          ref={popoverRef}
          active={active}
          months={months}
          exactValues={exactValues}
          onPointerEnter={cancelClose}
          onPointerLeave={scheduleClose}
          onClose={() => setActive(null)}
        />,
        document.body,
      )}
    </>
  );
}

const TeamPopover = forwardRef<HTMLDivElement, {
  active: ActiveTeam;
  months: TeamMonth[];
  exactValues: boolean;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onClose: () => void;
}>(function TeamPopover({
  active,
  months,
  exactValues,
  onPointerEnter,
  onPointerLeave,
  onClose,
}, ref) {
  const money = (value: number) => formatExecutiveCurrency(value, exactValues);
  const compactMoney = (value: number) => formatExecutiveCurrency(value, false);
  const members = active.team.members ?? [];
  const maxMemberTotal = Math.max(1, ...members.map((member) => member.total));
  const position = positionPopover(active);

  return (
    <>
      {position.mobile && <button type="button" className="fixed inset-0 z-[90] bg-black/15" onClick={onClose} aria-label="Fechar ranking da equipe" />}
      <div
        ref={ref}
        id={TOOLTIP_ID}
        role={active.pinned ? "dialog" : "tooltip"}
        aria-label={active.pinned ? `Ranking da equipe ${active.team.name}` : undefined}
        aria-modal={active.pinned && position.mobile ? true : undefined}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        className="fixed z-[100] overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl shadow-black/10 dark:border-neutral-700 dark:bg-neutral-950 dark:shadow-black/40"
        style={position.style}
      >
        <header className="flex items-center gap-2.5 border-b border-neutral-200 px-3.5 py-3 dark:border-neutral-800">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
            <Trophy className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-2">
              <h3 className="truncate text-lg font-semibold text-neutral-950 dark:text-white">{active.team.name}</h3>
              <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{members.length} vendedores</span>
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Ranking dos últimos 3 meses</p>
          </div>
          {active.pinned && (
            <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800" aria-label="Fechar">
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
        </header>

        <div className="max-h-[min(18rem,55vh)] overflow-y-auto px-3.5 scrollbar-thin">
          {members.map((member, index) => (
            <div key={member.id} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-x-2.5 border-b border-neutral-100 py-2.5 last:border-0 dark:border-neutral-900">
              <span className={`mt-0.5 text-center text-xs font-semibold tabular-nums ${rankingColor(index)}`}>{index + 1}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{member.name}</p>
                <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                  <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(3, (member.total / maxMemberTotal) * 100)}%` }} />
                </div>
                <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                  {member.values.map((value, monthIndex) => (
                    <span key={months[monthIndex] ? `${months[monthIndex].year}-${months[monthIndex].month}` : monthIndex}>
                      <span className="capitalize">{months[monthIndex]?.label}</span> {compactMoney(value)}
                    </span>
                  ))}
                </p>
              </div>
              <strong className="text-sm font-semibold tabular-nums text-neutral-950 dark:text-white">{money(member.total)}</strong>
            </div>
          ))}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-neutral-200 bg-neutral-50 px-3.5 py-2.5 dark:border-neutral-800 dark:bg-neutral-900/70">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">
            <UsersRound className="h-3.5 w-3.5" strokeWidth={2} />
            Total da equipe
          </span>
          <strong className="text-base font-semibold tabular-nums text-neutral-950 dark:text-white">{money(active.team.total)}</strong>
        </footer>
      </div>
    </>
  );
});

function positionPopover(active: ActiveTeam): { mobile: boolean; style: CSSProperties } {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  if (viewportWidth < 640) {
    return {
      mobile: true,
      style: { right: 12, bottom: 12, left: 12, maxHeight: "calc(100vh - 24px)" },
    };
  }

  const width = Math.min(360, viewportWidth - 24);
  const estimatedHeight = Math.min(390, 104 + (active.team.members?.length ?? 0) * 54);
  const rightSide = active.anchor.right + 12;
  const left = rightSide + width <= viewportWidth - 12
    ? rightSide
    : Math.max(12, active.anchor.left - width - 12);
  const top = Math.min(
    Math.max(12, active.anchor.top - 18),
    Math.max(12, viewportHeight - estimatedHeight - 12),
  );
  return {
    mobile: false,
    style: { top, left, width, maxHeight: "calc(100vh - 24px)" },
  };
}

function rankingColor(index: number): string {
  if (index === 0) return "text-amber-600 dark:text-amber-400";
  if (index === 1) return "text-blue-600 dark:text-blue-400";
  if (index === 2) return "text-orange-600 dark:text-orange-400";
  return "text-neutral-400 dark:text-neutral-500";
}
