/**
 * Pool de workers simples — mantém N chamadas em voo o tempo todo (em vez de
 * lotes de tamanho fixo que esperam a mais lenta do lote pra seguir). O
 * banco é remoto (~40ms de ida-e-volta) e cada operação do Prisma aqui é
 * embrulhada em várias idas ao banco por causa do RLS (SET LOCAL por
 * operação) — processar uma linha de cada vez deixa isso 100% serializado.
 * Rodar várias linhas em paralelo não muda o custo por linha, só para de
 * esperar uma terminar pra começar a próxima.
 */
export async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const poolSize = Math.max(1, Math.min(concurrency, items.length));
  const runners = Array.from({ length: poolSize }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}
