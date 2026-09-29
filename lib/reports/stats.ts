/**
 * Estatísticas básicas de distribuição (média, mediana) usadas pelo relatório
 * Administrativo (tempo até finalização de processo, ver admin-reports-view.tsx)
 * — extraído de uma versão calculada na mão que existia ali. Também tinha um
 * `percentile` aqui, usado só pelo SLA de resposta do relatório Comercial
 * (removido) — removido junto por não ter mais chamador.
 */

export function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Média e mediana juntas — média sozinha é enganosa quando tem 1-2 caso que
 * demorou muito mais que o normal (ex.: um processo com pendência de
 * documentação travado por meses); a mediana mostra o caso "típico" sem
 * esse puxão.
 */
export function summarizeDurations(values: number[]): { avgMs: number | null; medianMs: number | null; count: number } {
  return { avgMs: average(values), medianMs: median(values), count: values.length };
}
