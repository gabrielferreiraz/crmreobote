import { Avatar } from "@/components/avatar";

export type LeaderboardEntry = {
  id: string;
  name: string;
  photoUrl?: string | null;
  primaryValue: string;
  secondaryValue?: string;
};

const RANK_BADGE: Record<number, string> = {
  1: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  2: "bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300",
  3: "bg-orange-100 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400",
};

/** Ranking numerado — top 3 ganham um selo discreto (ouro/prata/bronze), sem virar emoji de medalha. */
export function Leaderboard({ entries, emptyLabel }: { entries: LeaderboardEntry[]; emptyLabel: string }) {
  if (entries.length === 0) {
    return <p className="py-8 text-center text-sm text-neutral-400 dark:text-neutral-500">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-0.5">
      {entries.map((entry, i) => {
        const rank = i + 1;
        return (
          <div key={entry.id} className="flex items-center gap-3 rounded-md px-1.5 py-2">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
                RANK_BADGE[rank] ?? "text-neutral-400 dark:text-neutral-500"
              }`}
            >
              {rank}
            </span>
            {entry.photoUrl !== undefined && <Avatar name={entry.name} src={entry.photoUrl} size="xs" className="shrink-0" />}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
              {entry.name}
            </span>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{entry.primaryValue}</p>
              {entry.secondaryValue && (
                <p className="text-[11px] text-neutral-400 dark:text-neutral-500">{entry.secondaryValue}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
