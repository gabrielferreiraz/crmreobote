import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="max-w-lg space-y-6 animate-loading-delay">
      <div className="space-y-1.5">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-3.5 w-28" />
      </div>

      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card flex items-center gap-3 p-4">
            <Skeleton className="h-9 w-9 shrink-0 rounded-md" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
