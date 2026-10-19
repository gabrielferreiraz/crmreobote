/**
 * Busca de vendas de comissão que ignora acento e maiúscula — quem digita
 * "joao" precisa achar "João" (o `contains` do Prisma com `insensitive` só
 * ignora maiúscula). Sem extensão no banco: `translate()` do Postgres troca
 * as letras acentuadas pelas sem acento dos dois lados da comparação.
 */

import type { Prisma } from "@/app/generated/prisma/client";
import { ACCENTED, PLAIN, plainSearchText } from "@/lib/commissions/search-text";

type Tx = Prisma.TransactionClient;

/** No máximo isto de resultados por busca — mais que isso, a pessoa refina o texto. */
export const SEARCH_LIMIT = 2000;

/**
 * Ids das vendas cujo cliente, vendedor, grupo ou cota contém `query`.
 * Precisa de transação com o tenant já definido (RLS: sem isso a consulta
 * crua voltaria vazia, sem erro).
 */
export async function searchCommissionSaleIds(tx: Tx, organizationId: string, query: string): Promise<string[]> {
  const text = plainSearchText(query);
  if (!text) return [];
  const pattern = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT s.id
      FROM "CommissionSale" s
      JOIN "User" u ON u.id = s."sellerId"
     WHERE s."organizationId" = ${organizationId}
       AND (
         translate(lower(s."clientName"), ${ACCENTED}, ${PLAIN}) LIKE ${pattern}
         OR translate(lower(u.name), ${ACCENTED}, ${PLAIN}) LIKE ${pattern}
         OR lower(coalesce(s."quotaNumber", '')) LIKE ${pattern}
         OR lower(coalesce(s."groupNumber", '')) LIKE ${pattern}
       )
     LIMIT ${SEARCH_LIMIT}`;
  return rows.map((r) => r.id);
}
