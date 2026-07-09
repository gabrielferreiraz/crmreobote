export function BarRow({
  label,
  value,
  max,
  displayValue,
}: {
  label: string;
  value: number;
  max: number;
  displayValue: string;
}) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;

  return (
    <div className="flex items-center gap-3 text-sm" title={`${label}: ${displayValue}`}>
      <span className="w-40 shrink-0 truncate text-neutral-500 dark:text-neutral-400">{label}</span>
      <div className="h-2 flex-1 rounded-full bg-neutral-100 dark:bg-neutral-800">
        <div
          className="h-2 rounded-full bg-neutral-900 dark:bg-white transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-24 shrink-0 text-right text-neutral-800 dark:text-neutral-200">{displayValue}</span>
    </div>
  );
}
