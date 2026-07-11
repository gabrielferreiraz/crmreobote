export const DEFAULT_PIPELINE_NAME = "Funil de Vendas";

// requiredFields vazio nas etapas de prospecção/nutrição (lead ainda frio,
// sem negócio comprometido) — exigir campo aí travaria, por exemplo, mandar
// um lead frio pra etapa de Remarketing.
export const DEFAULT_STAGES = [
  { name: "Prospecção", order: 1, color: "#6366f1", requiredFields: [] },
  { name: "Mensagem/Ligação", order: 2, color: "#8b5cf6", requiredFields: [] },
  { name: "No-show", order: 3, color: "#f59e0b", requiredFields: [] },
  { name: "Remarketing", order: 4, color: "#f97316", requiredFields: [] },
  { name: "Visita Marcada", order: 5, color: "#06b6d4", requiredFields: ["value"] },
  { name: "Em Análise", order: 6, color: "#3b82f6", requiredFields: ["value"] },
  { name: "Quente", order: 7, color: "#10b981", requiredFields: ["value"] },
  { name: "Extras", order: 8, color: "#64748b", requiredFields: ["value"] },
] as const;
