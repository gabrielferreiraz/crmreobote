import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-8 animate-loading-delay">
      <Skeleton className="h-6 w-24" />

      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card space-y-3 p-4">
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-7 w-12" />
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <Skeleton className="h-4 w-40" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card flex items-center gap-3 p-3">
              <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
