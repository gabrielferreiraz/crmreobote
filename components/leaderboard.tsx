import type { ReactNode } from "react";
import { Avatar } from "@/components/avatar";

export type LeaderboardEntry = {
  id: string;
  name: string;
  photoUrl?: string | null;
  primaryValue: string;
  barValue?: number;
  secondaryValue?: string;
  details?: { label: string; value: number | string }[];
  /** Ação opcional no fim da linha (ex.: "Ver negócios" do card "Negócios fechados") — montada por quem usa o ranking, este componente só dá o lugar. */
  action?: ReactNode;
};

const RANK_BADGE: Record<number, string> = {
  1: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  2: "bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300",
  3: "bg-orange-100 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400",
};

/** Linhas cinza semitransparentes na forma exata de uma linha real (selo + avatar + nome + valor) —
 * preenche o mesmo espaço físico que o card teria com dados, em vez de deixar um card quase vazio
 * com uma frase perdida no meio, sem quebrar o ritmo visual da página quando um filtro não bate dados. */
function LeaderboardSkeleton({ emptyLabel }: { emptyLabel: string }) {
  return (
    <div className="space-y-0.5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 rounded-md px-1.5 py-2 opacity-50">
          <span className="h-6 w-6 shrink-0 rounded-full bg-neutral-100 dark:bg-neutral-800" />
          <span className="h-6 w-6 shrink-0 rounded-full bg-neutral-100 dark:bg-neutral-800" />
          <span className="h-2.5 min-w-0 flex-1 rounded-full bg-neutral-100 dark:bg-neutral-800" style={{ maxWidth: `${70 - i * 15}%` }} />
          <span className="h-2.5 w-10 shrink-0 rounded-full bg-neutral-100 dark:bg-neutral-800" />
        </div>
      ))}
      <p className="pt-2 text-center text-sm text-neutral-400 dark:text-neutral-500">{emptyLabel}</p>
    </div>
  );
}

/** Ranking numerado — top 3 ganham um selo discreto (ouro/prata/bronze), sem virar emoji de medalha. */
export function Leaderboard({ entries, emptyLabel }: { entries: LeaderboardEntry[]; emptyLabel: string }) {
  if (entries.length === 0) {
    return <LeaderboardSkeleton emptyLabel={emptyLabel} />;
  }

  return (
    <div className="divide-y divide-neutral-100 dark:divide-neutral-800/70">
      {entries.map((entry, i) => {
        const rank = i + 1;
        const hasAvatar = entry.photoUrl !== undefined;
        return (
          <div
            key={entry.id}
            className={`grid items-start gap-x-2.5 px-2 py-3 group-data-[expanded=true]/ranking:py-5 ${hasAvatar ? "grid-cols-[1.75rem_1.75rem_minmax(0,1fr)]" : "grid-cols-[1.75rem_minmax(0,1fr)]"}`}
          >
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
                RANK_BADGE[rank] ?? "text-neutral-400 dark:text-neutral-500"
              }`}
            >
              {rank}
            </span>
            {hasAvatar && <Avatar name={entry.name} src={entry.photoUrl} size="sm" />}
            <span className="min-w-0 self-center text-sm font-semibold text-neutral-800 group-data-[expanded=false]/ranking:truncate group-data-[expanded=true]/ranking:text-lg dark:text-neutral-200">
              {entry.name}
            </span>
            <div className={`min-w-0 ${hasAvatar ? "col-start-3" : "col-start-2"}`}>
              <p className="mt-1 text-lg leading-tight font-bold tabular-nums text-neutral-900 group-data-[expanded=true]/ranking:text-2xl dark:text-neutral-100">{entry.primaryValue}</p>
              {entry.details && entry.details.length > 0 && (
                <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 border-t border-neutral-100 pt-3 group-data-[expanded=false]/ranking:hidden sm:grid-cols-2 dark:border-neutral-800">
                  {entry.details.map((detail) => (
                    <div key={detail.label} className="min-w-0">
                      <dt className="text-sm text-neutral-500 dark:text-neutral-400">{detail.label}</dt>
                      <dd className="mt-0.5 break-words text-lg font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{typeof detail.value === "number" ? detail.value.toLocaleString("pt-BR") : detail.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {(entry.secondaryValue || entry.action) && (
                <div className={`mt-2 flex flex-wrap items-center justify-between gap-2 ${entry.action ? "" : "group-data-[expanded=false]/ranking:hidden"}`}>
                  {entry.secondaryValue ? (
                    <p className="min-w-0 text-sm text-neutral-500 group-data-[expanded=false]/ranking:hidden dark:text-neutral-400">{entry.secondaryValue}</p>
                  ) : (
                    <span />
                  )}
                  {entry.action}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
