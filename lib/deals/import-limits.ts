/**
 * Limites compartilhados pela prévia e pelo commit da importação de negócios
 * (ver app/api/deals/import/route.ts e .../preview/route.ts). Mesmo raciocínio
 * de lib/contacts/import-limits.ts — um lugar só, pra prévia e commit nunca
 * divergirem sobre o que é "grande demais".
 */
export const MAX_DEAL_IMPORT_ROWS = 5_000;
export const MAX_DEAL_IMPORT_FILE_SIZE_BYTES = 25 * 1024 * 1024;

// Com 5x mais linhas que antes, o teto padrão de transação do Prisma (5s/2s
// de espera) fica apertado demais — mesmo ajuste que a importação de
// contatos já usa pro mesmo motivo (lib/contacts/import-limits.ts).
export const DEAL_IMPORT_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;
