"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Select } from "@/components/select";

/**
 * Filtro por funil — mesmo parâmetro de URL (?pipelineId=<id>) que o gráfico
 * de etapas já lia sozinho (ver relatorios/page.tsx), agora também exposto
 * como filtro visível pro resto do relatório (receita, ranking, cargo,
 * motivo de perda, etc.). Vazio = "todos os funis" (comportamento de
 * sempre, nada muda pra quem não mexe no filtro) — só estreita quando um
 * funil específico é escolhido.
 */
export function PipelineFilter({ pipelines }: { pipelines: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("pipelineId") ?? "";

  if (pipelines.length <= 1) return null;

  function apply(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("pipelineId", value);
    else params.delete("pipelineId");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const options = [{ value: "", label: "Todos os funis" }, ...pipelines.map((p) => ({ value: p.id, label: p.name }))];

  return <Select value={current} onChange={apply} options={options} className="w-48" />;
}
