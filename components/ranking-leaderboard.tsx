"use client";

import { useState } from "react";
import { Avatar } from "@/components/avatar";
import type { LeaderboardEntry } from "@/components/leaderboard";

const RANK_BADGE: Record<number, string> = {
  1: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  2: "bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300",
  3: "bg-orange-100 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400",
};

export function RankingLeaderboard({ entries, emptyLabel }: { entries: LeaderboardEntry[]; emptyLabel: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0];

  if (!selected) {
    return <p className="py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">{emptyLabel}</p>;
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 sm:group-data-[expanded=true]/ranking:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <ol className="scrollbar-thin min-h-0 max-h-[440px] overflow-y-auto pr-2 group-data-[expanded=true]/ranking:max-h-[230px] group-data-[expanded=true]/ranking:sm:max-h-[540px]">
        {entries.map((entry, index) => {
          const rank = index + 1;
          const hasAvatar = entry.photoUrl !== undefined;
          const isSelected = entry.id === selected.id;
          return (
            <li key={entry.id} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/70">
              <button
                type="button"
                data-ranking-select
                onMouseEnter={() => setSelectedId(entry.id)}
                onFocus={() => setSelectedId(entry.id)}
                onClick={() => setSelectedId(entry.id)}
                aria-pressed={isSelected}
                className={`grid w-full items-start gap-x-2.5 px-2 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-brand group-data-[expanded=true]/ranking:rounded-sm ${
                  hasAvatar ? "grid-cols-[1.75rem_1.75rem_minmax(0,1fr)]" : "grid-cols-[1.75rem_minmax(0,1fr)]"
                } ${isSelected ? "group-data-[expanded=true]/ranking:bg-brand/5 dark:group-data-[expanded=true]/ranking:bg-brand/10" : "hover:bg-neutral-50 dark:hover:bg-neutral-900/60"}`}
              >
                <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${RANK_BADGE[rank] ?? "text-neutral-400 dark:text-neutral-500"}`}>
                  {rank}
                </span>
                {hasAvatar && <Avatar name={entry.name} src={entry.photoUrl} size="sm" />}
                <span className="min-w-0 self-center truncate text-sm font-semibold text-neutral-800 dark:text-neutral-200">{entry.name}</span>
                <span className={`mt-1 min-w-0 text-lg leading-tight font-semibold tabular-nums text-neutral-900 dark:text-neutral-100 ${hasAvatar ? "col-start-3" : "col-start-2"}`}>
                  {entry.primaryValue}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div
        role="region"
        aria-label={`Detalhes de ${selected.name}`}
        className="scrollbar-thin hidden min-h-0 max-h-[540px] overflow-y-auto border-t border-neutral-100 px-1 pt-5 group-data-[expanded=true]/ranking:block sm:group-data-[expanded=true]/ranking:border-t-0 sm:group-data-[expanded=true]/ranking:border-l sm:group-data-[expanded=true]/ranking:pl-6 sm:group-data-[expanded=true]/ranking:pt-1 dark:border-neutral-800"
      >
        <div className="flex min-w-0 items-center gap-3">
          {selected.photoUrl !== undefined && <Avatar name={selected.name} src={selected.photoUrl} size="md" />}
          <p className="min-w-0 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{selected.name}</p>
        </div>
        <p className="mt-4 break-words text-2xl leading-tight font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{selected.primaryValue}</p>
        {selected.details && selected.details.length > 0 && (
          <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-neutral-100 pt-4 dark:border-neutral-800">
            {selected.details.map((detail) => (
              <div key={detail.label} className="min-w-0">
                <dt className="text-sm text-neutral-500 dark:text-neutral-400">{detail.label}</dt>
                <dd className="mt-1 break-words text-xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                  {typeof detail.value === "number" ? detail.value.toLocaleString("pt-BR") : detail.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {selected.secondaryValue && <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">{selected.secondaryValue}</p>}
        {selected.action && <div data-ranking-action className="mt-5 border-t border-neutral-100 pt-3 dark:border-neutral-800">{selected.action}</div>}
      </div>
    </div>
  );
}
