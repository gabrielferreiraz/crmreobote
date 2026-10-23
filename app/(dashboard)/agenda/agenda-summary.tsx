import { AlertCircle, CalendarCheck2, CalendarRange, Clock3 } from "lucide-react";
import type { AgendaFocus } from "./agenda-utils";

type SummaryCounts = {
  pending: number;
  overdue: number;
  today: number;
  upcoming: number;
  noDate: number;
};

const ITEMS = [
  {
    key: "overdue" as const,
    label: "Atrasadas",
    icon: AlertCircle,
    tone: "text-red-600 dark:text-red-400",
    iconBg: "bg-red-50 dark:bg-red-500/10",
  },
  {
    key: "today" as const,
    label: "Hoje",
    icon: CalendarCheck2,
    tone: "text-brand",
    iconBg: "bg-brand-light dark:bg-brand/10",
  },
  {
    key: "upcoming" as const,
    label: "Próximas",
    icon: CalendarRange,
    tone: "text-neutral-700 dark:text-neutral-200",
    iconBg: "bg-neutral-100 dark:bg-neutral-800",
  },
  {
    key: "noDate" as const,
    label: "Sem prazo",
    icon: Clock3,
    tone: "text-amber-600 dark:text-amber-400",
    iconBg: "bg-amber-50 dark:bg-amber-500/10",
  },
];

export function AgendaSummary({
  counts,
  active,
  onChange,
}: {
  counts: SummaryCounts;
  active: AgendaFocus;
  onChange: (focus: AgendaFocus) => void;
}) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white/60 p-2 dark:border-neutral-800 dark:bg-neutral-950/30">
      <div className="flex items-center justify-between px-3 py-2.5">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Sua agenda</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Prioridades</p>
        </div>
        <button
          type="button"
          onClick={() => onChange("all")}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            active === "all"
              ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
              : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
          }`}
        >
          {counts.pending} pendentes
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {ITEMS.map(({ key, label, icon: Icon, tone, iconBg }) => {
          const selected = active === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(selected ? "all" : key)}
              className={`flex min-h-20 items-center gap-3 rounded-xl px-3 py-3 text-left transition-all ${
                selected
                  ? "bg-brand-light ring-1 ring-brand/20 dark:bg-brand/10 dark:ring-brand/30"
                  : "bg-neutral-50/80 hover:bg-neutral-100 dark:bg-neutral-900/60 dark:hover:bg-neutral-900"
              }`}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${iconBg}`}>
                <Icon className={`h-4.5 w-4.5 ${tone}`} strokeWidth={2} />
              </span>
              <span className="min-w-0">
                <span className="block text-xl font-semibold leading-none text-neutral-900 dark:text-neutral-100">
                  {counts[key]}
                </span>
                <span className={`mt-1 block text-sm font-medium ${selected ? "text-brand" : "text-neutral-500 dark:text-neutral-400"}`}>
                  {label}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
