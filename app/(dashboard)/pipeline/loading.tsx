import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="flex h-full flex-col gap-3 animate-loading-delay">
      {/* Desktop — kanban */}
      <div className="hidden h-full flex-col gap-3 lg:flex">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-20" />
          <div className="ml-auto flex gap-2">
            <Skeleton className="h-9 w-9" />
            <Skeleton className="h-9 w-9" />
            <Skeleton className="h-9 w-28" />
          </div>
        </div>
        <div className="scrollbar-thin flex flex-1 gap-3 overflow-x-auto">
          {Array.from({ length: 4 }).map((_, col) => (
            <div key={col} className="card flex w-72 shrink-0 flex-col gap-2 p-2.5">
              <div className="flex items-center justify-between px-1 pb-1">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3.5 w-6" />
              </div>
              {Array.from({ length: 3 }).map((_, card) => (
                <div
                  key={card}
                  className="space-y-2 rounded-lg border border-neutral-200/60 p-3 dark:border-neutral-800/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="h-5 w-5 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-20" />
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-3 w-14" />
                    <Skeleton className="h-3 w-10" />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Mobile — abas de etapa + lista vertical */}
      <div className="flex flex-1 flex-col gap-3 lg:hidden">
        <Skeleton className="h-10 w-full" />
        <div className="flex gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-20 shrink-0 rounded-full" />
          ))}
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card space-y-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-5 w-5 rounded-full" />
              </div>
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
