"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Pagination } from "@/components/pagination";
import { daysSince } from "@/lib/format";

export type StaleDeal = {
  id: string;
  name: string;
  stageEnteredAt: string | Date;
  stage: { name: string };
  contact: { name: string };
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 10;

/**
 * Paginado à parte do resto da Início: dono/admin sem filtro de escopo pode
 * ter centenas/milhares de negócios parados — mandar tudo de uma vez pro
 * servidor montar o HTML (como era antes) deixava a Início pesada só por
 * causa dessa lista. `initialDeals`/`initialTotalCount` cobrem a 1ª página
 * (mesma consulta que o server já fazia); páginas seguintes buscam em
 * /api/deals, que já tem o where + escopo compartilhados com o resto do app.
 */
export function StaleDealsList({
  initialDeals,
  initialTotalCount,
  staleBefore,
  staleDays,
}: {
  initialDeals: StaleDeal[];
  initialTotalCount: number;
  staleBefore: string;
  staleDays: number;
}) {
  const [deals, setDeals] = useState(initialDeals);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const skipNextFetch = useRef(true);

  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      status: "OPEN",
      stageEnteredBefore: staleBefore,
      sortDir: "asc",
      skip: String((page - 1) * pageSize),
      limit: String(pageSize),
    });
    fetch(`/api/deals?${params}`)
      .then(async (res) => {
        if (cancelled) return;
        const data = (await res.json()) as StaleDeal[];
        setDeals(data);
        setTotalCount(Number(res.headers.get("X-Total-Count") ?? data.length));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, pageSize, staleBefore]);

  if (totalCount === 0) return null;

  return (
    <div>
      <h2 className="mb-3 text-sm font-medium text-neutral-700 dark:text-neutral-300">
        Negócios parados (sem trocar de etapa há {staleDays}+ dias)
      </h2>
      <div className={`space-y-2 ${loading ? "opacity-60" : ""}`}>
        {deals.map((deal) => (
          <Link
            key={deal.id}
            href={`/negocios/${deal.id}`}
            className="card flex items-center justify-between p-3 text-sm hover:border-neutral-300 dark:hover:border-neutral-700"
          >
            <span className="flex items-center gap-2 text-neutral-800 dark:text-neutral-200">
              <Avatar name={deal.contact.name} size="xs" />
              {deal.name} <span className="text-neutral-500 dark:text-neutral-400">· {deal.contact.name}</span>
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
              <Clock className="h-3 w-3" strokeWidth={2} />
              {deal.stage.name} · {daysSince(deal.stageEnteredAt)}d
            </span>
          </Link>
        ))}
      </div>
      <div className="mt-3">
        <Pagination
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          itemLabel="negócios parados"
        />
      </div>
    </div>
  );
}
