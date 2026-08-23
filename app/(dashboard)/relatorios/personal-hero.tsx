import { Trophy, TrendingUp, Percent, Zap } from "lucide-react";
import { formatCurrency, formatDuration } from "@/lib/format";
import { Avatar } from "@/components/avatar";

/**
 * Hero de "Meu desempenho" exibido pra MEMBER e SUPERVISOR no topo do
 * relatório — substitui o título genérico "Panorama comercial" por um card
 * focado no próprio usuário: posição no ranking, negócios, ticket, SLA.
 *
 * Recebe só os dados já calculados por getCommercialReportData (que já filtra
 * pelo escopo do cargo — nenhuma query extra aqui).
 */
export function PersonalHero({
  name,
  photoUrl,
  role,
  wonCount,
  wonTotalValue,
  avgWonValue,
  winRate,
  rankingPosition,
  totalRankingMembers,
  slaFirstTouchWithin1h,
  avgFirstReplyMs,
  currentMonthLabel,
}: {
  name: string;
  photoUrl?: string | null;
  role: "MEMBER" | "SUPERVISOR";
  wonCount: number;
  wonTotalValue: number;
  avgWonValue: number;
  winRate: number;
  /** posição no ranking do time (1-indexed, null se sem vendas) */
  rankingPosition: number | null;
  totalRankingMembers: number;
  slaFirstTouchWithin1h: number | null;
  avgFirstReplyMs: number | null;
  currentMonthLabel: string;
}) {
  const roleLabel = role === "SUPERVISOR" ? "Supervisor" : "Consultor";
  const hasSales = wonCount > 0;

  const slaStatus =
    slaFirstTouchWithin1h === null
      ? null
      : slaFirstTouchWithin1h >= 70
        ? "good"
        : slaFirstTouchWithin1h >= 40
          ? "warn"
          : "bad";

  const slaColorClass = {
    good: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    bad: "text-red-600 dark:text-red-400",
  };

  return (
    <div className="card overflow-hidden p-0">
      {/* Cabeçalho com gradiente de marca */}
      <div className="flex flex-wrap items-center gap-4 border-b border-neutral-100 bg-gradient-to-r from-brand-light/60 to-transparent px-6 py-5 dark:border-neutral-800 dark:from-brand-light/20">
        <Avatar name={name} src={photoUrl ?? null} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-brand uppercase">
            {roleLabel} · {currentMonthLabel}
          </p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Meu desempenho
          </h1>
          <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
            {name}
            {rankingPosition !== null && totalRankingMembers > 1 && (
              <>
                {" · "}
                <span className="font-medium text-neutral-700 dark:text-neutral-300">
                  {rankingPosition}º lugar
                </span>{" "}
                no ranking do time
              </>
            )}
          </p>
        </div>
        {rankingPosition === 1 && (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-500/15">
            <Trophy className="h-5 w-5 text-amber-500" strokeWidth={2} />
          </div>
        )}
      </div>

      {/* Grid de KPIs */}
      <div className="grid grid-cols-2 divide-x divide-y divide-neutral-100 sm:grid-cols-4 dark:divide-neutral-800">
        <KpiCell
          icon={<TrendingUp className="h-4 w-4 text-emerald-500" strokeWidth={2} />}
          label="Total ganho"
          value={hasSales ? formatCurrency(wonTotalValue) : "—"}
          sub={hasSales ? `${wonCount} negócio${wonCount === 1 ? "" : "s"}` : "Nenhuma venda no período"}
          highlight={hasSales}
        />
        <KpiCell
          icon={<Trophy className="h-4 w-4 text-amber-500" strokeWidth={2} />}
          label="Ticket médio"
          value={hasSales ? formatCurrency(avgWonValue) : "—"}
          sub={hasSales ? "por negócio ganho" : undefined}
        />
        <KpiCell
          icon={<Percent className="h-4 w-4 text-brand" strokeWidth={2} />}
          label="Taxa de conversão"
          value={`${winRate}%`}
          sub="ganhos ÷ decididos"
        />
        <KpiCell
          icon={<Zap className="h-4 w-4 text-violet-500" strokeWidth={2} />}
          label="Contato em <1h"
          value={slaFirstTouchWithin1h !== null ? `${slaFirstTouchWithin1h}%` : "—"}
          sub={
            avgFirstReplyMs !== null
              ? `Resposta média: ${formatDuration(avgFirstReplyMs)}`
              : "Sem dados de SLA no período"
          }
          statusColorClass={slaStatus ? slaColorClass[slaStatus] : undefined}
        />
      </div>
    </div>
  );
}

function KpiCell({
  icon,
  label,
  value,
  sub,
  highlight,
  statusColorClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  statusColorClass?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 p-5 ${highlight ? "bg-emerald-50/50 dark:bg-emerald-500/5" : ""}`}>
      <div className="flex items-center gap-1.5">
        {icon}
        <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{label}</p>
      </div>
      <p
        className={`text-2xl font-bold tabular-nums tracking-tight ${
          statusColorClass ??
          (highlight ? "text-emerald-700 dark:text-emerald-400" : "text-neutral-900 dark:text-neutral-100")
        }`}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-neutral-400 dark:text-neutral-500">{sub}</p>}
    </div>
  );
}

/**
 * Extrai a posição (1-indexed) do usuário logado no ranking de fechamentos.
 * Retorna null se o usuário não aparece (zero vendas no período).
 */
export function findRankingPosition(
  ranking: { name: string }[],
  userName: string,
): number | null {
  const idx = ranking.findIndex((r) => r.name === userName);
  return idx === -1 ? null : idx + 1;
}
