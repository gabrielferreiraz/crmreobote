import { Skeleton } from "@/components/skeleton";

function ConversationRowSkeleton() {
  return (
    <div className="flex items-center gap-2.5 p-2">
      <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="flex h-full flex-col gap-4 animate-loading-delay">
      <div className="hidden space-y-2 lg:block">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-3.5 w-64" />
      </div>

      {/* Desktop — lista + conversa lado a lado */}
      <div className="hidden min-h-0 flex-1 gap-4 lg:flex">
        <div className="card flex w-80 shrink-0 flex-col overflow-hidden">
          <div className="flex items-center gap-1.5 p-2.5">
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="h-8 w-16" />
          </div>
          <div className="space-y-0.5 p-1.5">
            {Array.from({ length: 7 }).map((_, i) => (
              <ConversationRowSkeleton key={i} />
            ))}
          </div>
        </div>
        <div className="card flex min-h-0 flex-1 items-center justify-center">
          <Skeleton className="h-10 w-10 rounded-full" />
        </div>
      </div>

      {/* Mobile — só a lista */}
      <div className="flex-1 space-y-0.5 lg:hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <ConversationRowSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
