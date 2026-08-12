/**
 * Filtro rápido único do Pipeline (Kanban/Lista) — nunca mais de um ativo ao
 * mesmo tempo, estado sobe pra pipeline-view.tsx e sincroniza com a URL
 * (?filter=) pra o card "Exige ação" do Início (ver action-required-card.tsx)
 * conseguir linkar direto pra um Pipeline já pré-filtrado. Arquivo próprio
 * (não dentro de kanban-board.tsx ou pipeline-view.tsx) porque os dois
 * precisam do mesmo tipo sem um importar do outro.
 */
export type PipelineQuickFilter = "acao-hoje" | "sem-tarefa" | "parados-14d" | "sem-valor";

export function isPipelineQuickFilter(value: string | null): value is PipelineQuickFilter {
  return value === "acao-hoje" || value === "sem-tarefa" || value === "parados-14d" || value === "sem-valor";
}
