"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Select } from "@/components/select";
import { PROCESS_PIPELINE_FILTER_KEY } from "./filters-storage";

type CategoryOption = { id: string; name: string; pipelines: { id: string; name: string }[] };

/**
 * Filtro por Categoria/Subcategoria do relatório de Processos — mesma ideia
 * de PipelineFilter (relatório Comercial), chave de localStorage própria
 * (ver filters-storage.ts) porque é um espaço de id totalmente diferente
 * (ProcessPipeline, não Pipeline de vendas). Vazio = todas as
 * categorias/subcategorias juntas.
 */
export function ProcessPipelineFilter({ categories }: { categories: CategoryOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("processPipelineId") ?? "";

  const totalPipelines = categories.reduce((sum, c) => sum + c.pipelines.length, 0);
  if (totalPipelines <= 1) return null;

  function apply(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("processPipelineId", value);
    else params.delete("processPipelineId");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    try {
      if (value) localStorage.setItem(PROCESS_PIPELINE_FILTER_KEY, value);
      else localStorage.removeItem(PROCESS_PIPELINE_FILTER_KEY);
    } catch {}
  }

  const options = [
    { value: "", label: "Todas as categorias" },
    ...categories.flatMap((c) => c.pipelines.map((p) => ({ value: p.id, label: `${c.name} · ${p.name}` }))),
  ];

  return <Select value={current} onChange={apply} options={options} className="w-56" />;
}
