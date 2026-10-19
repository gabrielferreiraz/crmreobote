import type { LucideIcon } from "lucide-react";

/**
 * Número grande de cima das telas de Comissões — o que a pessoa procura
 * primeiro ("quanto eu recebo?"), sem precisar ler mais nada. Rótulo curto
 * em cima, valor grande, uma dica de no máximo 3 palavras embaixo.
 */
export function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "brand" | "warning" | "success";
}) {
  const iconTone = {
    neutral: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
    brand: "bg-brand-light text-brand dark:bg-brand-light dark:text-brand",
    warning: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
    success: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
  }[tone];

  return (
    <div className="card flex min-h-24 items-center gap-3 rounded-lg p-4">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${iconTone}`}>
        <Icon className="h-5 w-5" strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{label}</p>
        <p className="truncate text-xl font-semibold tracking-tight text-neutral-900 tabular-nums dark:text-neutral-100">{value}</p>
        {hint && <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{hint}</p>}
      </div>
    </div>
  );
}
