"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Select } from "@/components/select";

/**
 * Janela de botões de página com reticências — nunca lista as ~600 páginas
 * possíveis (117 mil negócios / 200 por página), só a atual ± 1, a primeira,
 * a última, e "…" no meio quando há um vão.
 */
function pageWindow(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = new Set<number>([1, total, current]);
  if (current > 1) pages.add(current - 1);
  if (current < total) pages.add(current + 1);

  const sorted = Array.from(pages).sort((a, b) => a - b);
  const result: (number | "...")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push("...");
    result.push(sorted[i]);
  }
  return result;
}

export function Pagination({
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100, 200],
  itemLabel = "itens",
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: number[];
  itemLabel?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
      <p className="text-xs text-neutral-400 dark:text-neutral-500">
        {totalCount === 0 ? `0 ${itemLabel}` : `${from}–${to} de ${totalCount} ${itemLabel}`}
      </p>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-neutral-400 dark:text-neutral-500">Por página</span>
          <Select
            value={String(pageSize)}
            onChange={(v) => onPageSizeChange(Number(v))}
            className="w-20 py-1 text-sm"
            options={pageSizeOptions.map((n) => ({ value: String(n), label: String(n) }))}
          />
        </div>

        {totalPages > 1 && (
          <div className="flex items-center gap-1 coarse:gap-0.5">
            <button
              type="button"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 disabled:pointer-events-none disabled:opacity-30 dark:text-neutral-400 dark:hover:bg-neutral-800 coarse:h-11 coarse:w-11"
              aria-label="Página anterior"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={2} />
            </button>

            {pageWindow(page, totalPages).map((p, i) =>
              p === "..." ? (
                <span key={`ellipsis-${i}`} className="px-1 text-xs text-neutral-400 dark:text-neutral-600">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPageChange(p)}
                  className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs font-medium tabular-nums transition-colors coarse:h-11 coarse:min-w-11 ${
                    p === page
                      ? "bg-brand text-white"
                      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  }`}
                >
                  {p}
                </button>
              ),
            )}

            <button
              type="button"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 disabled:pointer-events-none disabled:opacity-30 dark:text-neutral-400 dark:hover:bg-neutral-800 coarse:h-11 coarse:w-11"
              aria-label="Próxima página"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
