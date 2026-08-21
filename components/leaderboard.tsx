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
    <div className="space-y-0.5">
      {entries.map((entry, i) => {
        const rank = i + 1;
        return (
          // Nome sozinho na própria linha, sem NADA "shrink-0" dividindo espaço
          // com ele — foi exatamente um vizinho de largura fixa na mesma linha
          // (o valor) que causava a sobreposição/espremida em cards estreitos
          // de 4 colunas (2 tentativas anteriores, ambas quebraram do mesmo
          // jeito: o nome multi-linha some por baixo do valor de largura fixa,
          // já que os dois disputam a MESMA linha em flexbox). Valor e detalhe
          // vão numa linha de baixo, sozinhos também — cada bloco com a
          // largura inteira do card só pra si, zero disputa, zero sobreposição
          // possível, não importa quão longo o nome ou o valor sejam.
          <div key={entry.id} className="rounded-md px-1.5 py-2">
            <div className="flex items-center gap-3">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
                  RANK_BADGE[rank] ?? "text-neutral-400 dark:text-neutral-500"
                }`}
              >
                {rank}
              </span>
              {entry.photoUrl !== undefined && <Avatar name={entry.name} src={entry.photoUrl} size="xs" className="shrink-0" />}
              {/* Nome menor, valor maior de propósito — quem abre este card
                  quer bater o olho no NÚMERO (quanto vendeu, qual taxa),
                  não em quem é; o nome é só contexto pra identificar a linha. */}
              <span className="min-w-0 flex-1 text-xs font-medium text-neutral-600 dark:text-neutral-400">
                {entry.name}
              </span>
            </div>
            <div className="pl-9">
              <p className="text-lg leading-tight font-bold tabular-nums text-neutral-900 dark:text-neutral-100">{entry.primaryValue}</p>
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
