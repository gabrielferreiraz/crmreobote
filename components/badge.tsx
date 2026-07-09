const TONES = {
  neutral: "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400",
  accent: "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900",
  success: "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  danger: "bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300",
  warning: "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

export function Badge({
  children,
  tone = "neutral",
  dot,
  className = "",
}: {
  children: React.ReactNode;
  tone?: keyof typeof TONES;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]} ${className}`}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
