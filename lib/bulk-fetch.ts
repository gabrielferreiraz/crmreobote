const BULK_REQUEST_CONCURRENCY = 6;

/**
 * Executa tarefas independentes sem abrir centenas de conexões de uma vez.
 * As funções, em vez de promises já iniciadas, são essenciais: cada fetch só
 * começa quando um dos workers fica livre.
 */
export async function settleBulkRequests<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  concurrency = BULK_REQUEST_CONCURRENCY,
): Promise<PromiseSettledResult<T>[]> {
  if (tasks.length === 0) return [];

  const results = new Array<PromiseSettledResult<T>>(tasks.length);
  const workerCount = Math.min(tasks.length, Math.max(1, Math.floor(concurrency)));
  let cursor = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await tasks[index]() };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/** Conta falhas de rede e respostas HTTP sem interromper o restante do lote. */
export async function countBulkFailures(requests: ReadonlyArray<() => Promise<Response>>): Promise<number> {
  const results = await settleBulkRequests(requests);
  return results.filter((r) => r.status === "rejected" || !r.value.ok).length;
}
