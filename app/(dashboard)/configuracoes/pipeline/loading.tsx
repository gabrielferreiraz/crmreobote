import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="max-w-lg space-y-4 animate-loading-delay">
      <div className="space-y-1.5">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-3.5 w-28" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card flex items-center gap-3 p-3">
            <Skeleton className="h-3 w-3 shrink-0 rounded-full" />
            <Skeleton className="h-3.5 flex-1" />
            <Skeleton className="h-6 w-6 shrink-0 rounded" />
            <Skeleton className="h-6 w-6 shrink-0 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
