type DailyMetric = { date: string; sent: number; replied: number };

/** Rótulo curto "dd/mm" a partir de uma date-key "YYYY-MM-DD" (evita fuso — não passa por Date). */
function shortLabel(dateKey: string): string {
  const [, month, day] = dateKey.split("-");
  return `${day}/${month}`;
}

/**
 * Gráfico de barras (envios × respostas por dia) — SVG puro, sem lib de
 * gráfico. Tooltip via CSS (group-hover), sem precisar de estado/JS no
 * cliente. Uma barra por série lado a lado, cor única por série (nunca por
 * rank), legenda sempre visível já que são 2 séries.
 */
export function CampaignMetricsChart({ data }: { data: DailyMetric[] }) {
  if (data.length === 0) {
    return (
      <div className="card flex h-40 items-center justify-center p-4 text-sm text-neutral-400 dark:text-neutral-500">
        Sem envios registrados ainda.
      </div>
    );
  }

  const maxValue = Math.max(1, ...data.map((d) => Math.max(d.sent, d.replied)));
  const chartHeight = 120;
  const barWidth = 10;
  const barGap = 3;
  const groupGap = 18;
  const groupWidth = barWidth * 2 + barGap;
  const width = data.length * (groupWidth + groupGap);

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Envios e respostas por dia</p>
        <div className="flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-neutral-900 dark:bg-white" />
            Enviadas
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Respondidas
          </span>
        </div>
      </div>

      <div className="scrollbar-thin overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${chartHeight + 24}`}
          width={width}
          height={chartHeight + 24}
          className="block"
          role="img"
          aria-label="Envios e respostas por dia"
        >
          {data.map((d, i) => {
            const x = i * (groupWidth + groupGap);
            const sentHeight = (d.sent / maxValue) * chartHeight;
            const repliedHeight = (d.replied / maxValue) * chartHeight;
            return (
              <g key={d.date}>
                <g className="group">
                  <rect
                    x={x}
                    y={chartHeight - sentHeight}
                    width={barWidth}
                    height={Math.max(sentHeight, d.sent > 0 ? 2 : 0)}
                    rx={2}
                    className="fill-neutral-900 dark:fill-white"
                  />
                  <title>
                    {shortLabel(d.date)} · {d.sent} enviada{d.sent === 1 ? "" : "s"}
                  </title>
                </g>
                <g className="group">
                  <rect
                    x={x + barWidth + barGap}
                    y={chartHeight - repliedHeight}
                    width={barWidth}
                    height={Math.max(repliedHeight, d.replied > 0 ? 2 : 0)}
                    rx={2}
                    className="fill-emerald-500"
                  />
                  <title>
                    {shortLabel(d.date)} · {d.replied} resposta{d.replied === 1 ? "" : "s"}
                  </title>
                </g>
                <text
                  x={x + groupWidth / 2}
                  y={chartHeight + 16}
                  textAnchor="middle"
                  className="fill-neutral-400 text-[9px] dark:fill-neutral-500"
                >
                  {shortLabel(d.date)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
