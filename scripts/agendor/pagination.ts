/**
 * Busca tudo de um findMany grande em páginas — cada operação do Prisma
 * roda dentro de uma mini-transação com teto de 15s (SET_CONFIG do RLS, ver
 * withTenantRls em lib/prisma.ts); uma tabela de dezenas/centenas de
 * milhares de linhas num findMany só estoura esse teto num banco remoto
 * (confirmado rodando de verdade: "Transaction API error: A commit cannot
 * be executed on an expired transaction" tanto em Deal quanto em Contact).
 * Paginar dá a cada página sua própria janela de 15s do zero.
 *
 * `orderBy: { id: "asc" }` fixo no chamador garante páginas estáveis
 * (skip/take não embaralha se a ordem for sempre a mesma) — leitura no
 * início do script, sem escrita concorrente na mesma tabela durante a
 * paginação, então não tem risco de pular/repetir linha por causa de uma
 * escrita no meio do caminho.
 */
const PAGE_SIZE = 5_000;

export async function findAllPaged<T>(fetchPage: (skip: number, take: number) => Promise<T[]>): Promise<T[]> {
  const all: T[] = [];
  let skip = 0;
  for (;;) {
    const page = await fetchPage(skip, PAGE_SIZE);
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }
  return all;
}
