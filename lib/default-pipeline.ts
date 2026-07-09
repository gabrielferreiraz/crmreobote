export const DEFAULT_PIPELINE_NAME = "Funil de Vendas";

export const DEFAULT_STAGES = [
  { name: "Prospecção", order: 1, color: "#6366f1" },
  { name: "Mensagem/Ligação", order: 2, color: "#8b5cf6" },
  { name: "No-show", order: 3, color: "#f59e0b" },
  { name: "Remarketing", order: 4, color: "#f97316" },
  { name: "Visita Marcada", order: 5, color: "#06b6d4" },
  { name: "Em Análise", order: 6, color: "#3b82f6" },
  { name: "Quente", order: 7, color: "#10b981" },
  { name: "Extras", order: 8, color: "#64748b" },
] as const;
