import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-8 animate-loading-delay">
      <Skeleton className="h-6 w-28" />

      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card space-y-2 p-4">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-7 w-12" />
          </div>
        ))}
      </div>

      {Array.from({ length: 3 }).map((_, block) => (
        <div key={block} className="space-y-3">
          <Skeleton className="h-4 w-48" />
          <div className="card space-y-3 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-3 w-10" />
                </div>
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
