import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="max-w-2xl space-y-4 animate-loading-delay">
      <Skeleton className="h-6 w-24" />
      <div className="card divide-y divide-neutral-100 dark:divide-neutral-800">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
