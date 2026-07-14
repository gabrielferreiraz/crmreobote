type Slice = { label: string; value: number; color: string };

// r escolhido de propósito: 2πr ≈ 100, então cada fatia em % do total já é
// diretamente o tamanho do traço no strokeDasharray, sem conversão extra.
const RADIUS = 15.9155;

/** Rosca simples via strokeDasharray — sem lib de gráfico, só SVG. */
export function DonutChart({
  slices,
  centerValue,
  centerLabel,
}: {
  slices: Slice[];
  centerValue?: string;
  centerLabel?: string;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0) || 1;
  let cumulative = 0;

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
      <div className="relative h-40 w-40 shrink-0">
        <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
          <circle cx="18" cy="18" r={RADIUS} fill="none" strokeWidth="3.5" className="stroke-neutral-100 dark:stroke-neutral-800" />
          {slices.map((s, i) => {
            if (s.value <= 0) return null;
            const pct = (s.value / total) * 100;
            const offset = -cumulative;
            cumulative += pct;
            return (
              <circle
                key={i}
                cx="18"
                cy="18"
                r={RADIUS}
                fill="none"
                stroke={s.color}
                strokeWidth="3.5"
                strokeDasharray={`${pct} ${100 - pct}`}
                strokeDashoffset={offset}
              />
            );
          })}
        </svg>
        {(centerValue || centerLabel) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
            {centerValue && (
              <span className="text-lg leading-tight font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                {centerValue}
              </span>
            )}
            {centerLabel && <span className="mt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">{centerLabel}</span>}
          </div>
        )}
      </div>
      <div className="w-full min-w-0 flex-1 space-y-3 sm:w-auto">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-2.5 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="min-w-0 flex-1 truncate text-neutral-600 dark:text-neutral-400">{s.label}</span>
            <span className="shrink-0 font-medium tabular-nums text-neutral-800 dark:text-neutral-200">
              {Math.round((s.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
