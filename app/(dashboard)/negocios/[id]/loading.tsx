import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6 animate-loading-delay">
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-52" />
          <Skeleton className="h-3.5 w-32" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      <div className="flex gap-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-24 rounded-md" />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4">
          <div className="card space-y-3 p-4">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-16 w-full" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="card flex gap-3 p-3">
                <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card space-y-3 p-4">
          <Skeleton className="h-3.5 w-28" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
