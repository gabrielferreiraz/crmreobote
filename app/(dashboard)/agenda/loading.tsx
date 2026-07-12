import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4 animate-loading-delay">
      <div className="space-y-2">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-3.5 w-72" />
      </div>

      {/* Desktop — calendário (visão padrão) */}
      <div className="hidden space-y-4 lg:block">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-9" />
          <div className="ml-auto flex gap-1">
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-8 w-16" />
          </div>
        </div>
        <div className="card p-3">
          <div className="mb-2 grid grid-cols-7 gap-1.5">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-3 w-8 justify-self-center" />
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: 35 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square w-full" />
            ))}
          </div>
        </div>
      </div>

      {/* Mobile — lista agrupada */}
      <div className="space-y-4 lg:hidden">
        <div className="flex items-center gap-2">
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="h-10 w-10" />
        </div>
        {Array.from({ length: 3 }).map((_, group) => (
          <div key={group} className="space-y-2">
            <Skeleton className="h-3.5 w-24" />
            {Array.from({ length: 2 }).map((_, row) => (
              <div key={row} className="card flex items-center gap-3 p-3">
                <Skeleton className="h-[18px] w-[18px] shrink-0 rounded-full" />
                <Skeleton className="h-3.5 flex-1" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
