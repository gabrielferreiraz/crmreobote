function Skeleton({ className }: { className: string }) {
  return <div className={`animate-skeleton-shimmer rounded-md ${className}`} />;
}

export default function ReportsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Carregando relatórios">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-72 max-w-[70vw]" />
        </div>
        <Skeleton className="hidden h-9 w-64 sm:block" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="card space-y-3 p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-32 max-w-full" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-4 p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-64 w-full" />
        </div>
        <div className="card space-y-4 p-5">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    </div>
  );
}
