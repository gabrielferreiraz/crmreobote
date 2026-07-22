export const DEFAULT_PROCESS_PIPELINE_NAME = "Pós-venda";

// Só um ponto de partida — etapa de processo é totalmente editável/criável
// pelo administrativo (ver /processos → configurar etapas), igual ao
// pipeline de vendas. "Finalizado" marcada como isFinal dispara aviso
// automático pro time administrativo quando um processo chega nela.
//
// Reflete o ciclo real do consórcio: Ganho → documentação → cota/grupo
// cadastrados (pagando, aguardando sorteio/lance) → Contemplado → entrega do
// bem (pós-contemplação, documentando tudo) → Finalizado (só acompanhamento
// de parcela até o fim, ou consórcio quitado).
export const DEFAULT_PROCESS_STAGES = [
  { name: "Aguardando Documentação", order: 1, color: "#6366f1", isFinal: false },
  { name: "Cota e Grupo Cadastrados", order: 2, color: "#f59e0b", isFinal: false },
  { name: "Contemplado", order: 3, color: "#10b981", isFinal: false },
  { name: "Pós-Contemplação", order: 4, color: "#06b6d4", isFinal: false },
  { name: "Finalizado", order: 5, color: "#64748b", isFinal: true },
] as const;
