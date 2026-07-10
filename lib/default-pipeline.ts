export const DEFAULT_PIPELINE_NAME = "Funil de Vendas";

// requiresValue = false nas etapas de prospecção/nutrição (lead ainda frio,
// sem negócio comprometido) — exigir valor aí travaria, por exemplo, mandar
// um lead frio pra etapa de Remarketing.
export const DEFAULT_STAGES = [
  { name: "Prospecção", order: 1, color: "#6366f1", requiresValue: false },
  { name: "Mensagem/Ligação", order: 2, color: "#8b5cf6", requiresValue: false },
  { name: "No-show", order: 3, color: "#f59e0b", requiresValue: false },
  { name: "Remarketing", order: 4, color: "#f97316", requiresValue: false },
  { name: "Visita Marcada", order: 5, color: "#06b6d4", requiresValue: true },
  { name: "Em Análise", order: 6, color: "#3b82f6", requiresValue: true },
  { name: "Quente", order: 7, color: "#10b981", requiresValue: true },
  { name: "Extras", order: 8, color: "#64748b", requiresValue: true },
] as const;
