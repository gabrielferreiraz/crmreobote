import { Skeleton } from "@/components/skeleton";

/**
 * Esqueleto genérico reaproveitado por todo `loading.tsx` do dashboard (ver
 * cada um em app/(dashboard)/*​/loading.tsx) — não tenta imitar o layout
 * exato da tela de destino (uma é Kanban, outra é chat, outra é tabela); o
 * objetivo é só dar retorno visual IMEDIATO no clique, não uma prévia
 * pixel-perfect. Extraído de configuracoes/loading.tsx (1º lugar que
 * resolveu isso) pra virar a mesma peça em toda rota, em vez de duplicar a
 * mesma marcação em cada `loading.tsx` novo.
 */
export function PageLoadingSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="card divide-y divide-neutral-100 dark:divide-neutral-800">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-4">
            <Skeleton className="h-9 w-9 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3.5 w-full max-w-72" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
