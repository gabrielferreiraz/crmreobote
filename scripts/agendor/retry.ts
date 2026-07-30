/**
 * Retry de fase inteira (não linha a linha) — visto na prática: a conexão
 * com o banco remoto pode cair no meio de um job de horas (erro real:
 * "Connection terminated unexpectedly" depois de só ~20 linhas). Como toda
 * fase é create-only (upsert por agendorContactId/agendorDealId/
 * agendorTaskId+ownerId), repetir a fase INTEIRA do zero é seguro e barato
 * — tudo que já foi criado só passa por uma checagem indexada rápida, não
 * é reprocessado de verdade.
 */
export async function withPhaseRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      const waitMs = attempt * 5000;
      console.error(
        `[retry] fase "${label}" falhou na tentativa ${attempt}/${maxAttempts} (${err instanceof Error ? err.message : err}) — tentando de novo em ${waitMs / 1000}s...`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastErr;
}
