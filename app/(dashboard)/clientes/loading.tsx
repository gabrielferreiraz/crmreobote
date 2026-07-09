import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4 animate-loading-delay">
      <Skeleton className="h-6 w-24" />

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-9 w-28" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-40" />
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-4 border-b border-neutral-200 dark:border-neutral-800 px-4 py-2.5">
          {["w-24", "w-32", "w-24", "w-20", "w-16"].map((w, i) => (
            <Skeleton key={i} className={`h-3 ${w}`} />
          ))}
        </div>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-neutral-100 dark:border-neutral-800 px-4 py-3 last:border-0">
            <div className="flex w-32 items-center gap-2">
              <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
              <Skeleton className="h-3.5 w-20" />
            </div>
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-3.5 w-6" />
          </div>
        ))}
      </div>
    </div>
  );
}
