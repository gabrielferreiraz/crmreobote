/**
 * Dispara várias requisições em paralelo (ações em massa em Clientes/
 * Negócios) sem deixar uma falha de rede isolada derrubar o lote inteiro.
 * `Promise.all` rejeita e propaga no primeiro `fetch` que falhar de verdade
 * (rede caiu, conexão resetada — não é o mesmo que HTTP 4xx/5xx, que resolve
 * normalmente com `res.ok = false`), mesmo com as outras chamadas ainda em
 * andamento no servidor — isso já derrubou seleções de 100+ negócios com uma
 * "unhandledRejection" no console e a seleção/tela travadas sem atualizar,
 * porque o `catch` nunca rodava antes do `clearSelection()`/`router.refresh()`.
 * `Promise.allSettled` deixa todas terminarem e só conta quantas falharam
 * (rede ou HTTP), pra UI seguir normalmente mesmo quando 1 de 100 falha.
 */
export async function countBulkFailures(requests: Promise<Response>[]): Promise<number> {
  const results = await Promise.allSettled(requests);
  return results.filter((r) => r.status === "rejected" || !r.value.ok).length;
}
