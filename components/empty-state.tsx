import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-light ring-1 ring-brand/10 dark:bg-brand-light dark:ring-brand/15">
        <Icon className="h-5 w-5 text-brand dark:text-brand" strokeWidth={1.75} />
      </div>
      <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{title}</p>
      {description && <p className="max-w-xs text-sm text-neutral-500 dark:text-neutral-400">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
