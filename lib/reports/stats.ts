/**
 * Estatísticas básicas de distribuição (média, mediana, percentil) usadas
 * pelos relatórios — extraído porque o Comercial (SLA de resposta) e o
 * Administrativo (tempo até finalização de processo) tinham cada um sua
 * própria versão de "média" e de "mediana" calculadas na mão.
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

/** `p` de 0 a 100. Ex.: percentile(values, 95) = valor que 95% dos casos ficam abaixo (ou igual) dele. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.round((p / 100) * (sorted.length - 1));
  return sorted[idx];
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
