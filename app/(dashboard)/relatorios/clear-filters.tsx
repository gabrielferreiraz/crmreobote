"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { FilterX } from "lucide-react";
import { PIPELINE_FILTER_KEY, TAGS_FILTER_KEY, WHO_FILTER_KEY } from "./filters-storage";

/**
 * "Limpar filtros" — zera de uma vez os filtros de ESCOLHA (funil,
 * equipe/responsável e tags), sem tocar no período (que sempre tem um valor,
 * "Este mês" por padrão). Só aparece quando há algum ativo, com a contagem:
 * como os filtros ficam lembrados entre visitas (ver filters-url-restore.tsx),
 * é ele que avisa que os números estão estreitados.
 *
 * Apaga também o que ficou guardado no navegador — senão o próximo "Relatórios"
 * no menu restauraria de volta o filtro que acabou de ser limpo.
 */
export function ClearReportFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const active = [searchParams.has("pipelineId"), searchParams.has("who"), searchParams.has("tag")].filter(Boolean).length;
  if (active === 0) return null;

  function clear() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("pipelineId");
    params.delete("who");
    params.delete("tag");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    try {
      localStorage.removeItem(PIPELINE_FILTER_KEY);
      localStorage.removeItem(WHO_FILTER_KEY);
      localStorage.removeItem(TAGS_FILTER_KEY);
    } catch {}
  }

  return (
    <button type="button" onClick={clear} className="btn-ghost btn-sm col-span-2 justify-center sm:col-span-1">
      <FilterX className="h-3.5 w-3.5" strokeWidth={2} />
      Limpar filtros
      <span className="rounded-full bg-neutral-900 px-1.5 text-[11px] leading-4 font-semibold text-white dark:bg-white dark:text-neutral-900">{active}</span>
    </button>
  );
}
