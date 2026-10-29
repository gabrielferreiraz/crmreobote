/**
 * Abrir uma planilha com o mínimo de idas e voltas ao banco (cada uma custa
 * ~40 ms com o banco remoto). O que o Excel/Sheets fazem ao abrir — trazer
 * estrutura + primeira tela de uma vez — aqui vira UMA transação:
 * planilha+colunas (1 consulta) → primeira página com totais (1) → nomes de
 * clientes/negócios/membros (0–3). As abas vêm em paralelo, numa consulta só.
 */

import { prisma, prismaRaw } from "@/lib/prisma";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { refIds, type CellValue } from "@/lib/sheets/column-types";
import { loadSheetColumnsTx, queryRowsTx, type RowQuery } from "@/lib/sheets/rows";

type Tx = Parameters<Parameters<typeof prismaRaw.$transaction>[0]>[0];

/** Nomes das referências (cliente/negócio/membro) das linhas, dentro da transação já aberta. */
async function referenceNamesTx(
  tx: Tx,
  organizationId: string,
  columns: { id: string; type: string }[],
  rows: { values: Record<string, CellValue> }[],
): Promise<Record<string, string>> {
  const ids = { USER: new Set<string>(), CONTACT: new Set<string>(), DEAL: new Set<string>() };
  for (const c of columns) {
    if (c.type !== "USER" && c.type !== "CONTACT" && c.type !== "DEAL") continue;
    for (const r of rows) {
      for (const v of refIds(r.values[c.id])) ids[c.type as keyof typeof ids].add(v);
    }
  }
  const out: Record<string, string> = {};
  if (ids.USER.size) for (const u of await tx.user.findMany({ where: { id: { in: [...ids.USER] } }, select: { id: true, name: true } })) out[u.id] = u.name ?? "";
  if (ids.CONTACT.size)
    for (const c of await tx.contact.findMany({ where: { organizationId, id: { in: [...ids.CONTACT] } }, select: { id: true, name: true } })) out[c.id] = c.name;
  if (ids.DEAL.size) for (const d of await tx.deal.findMany({ where: { organizationId, id: { in: [...ids.DEAL] } }, select: { id: true, name: true } })) out[d.id] = d.name;
  return out;
}

/** Abas do rodapé: só id e nome, na ordem de criação (sem contar linhas — isso é da tela de lista). */
export function listSheetTabs(organizationId: string) {
  return runWithTenant(organizationId, () =>
    prisma.sheet.findMany({ where: { organizationId, archivedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
  );
}

/** Tudo que a tela precisa para abrir a planilha, numa transação. */
export async function openSheet(organizationId: string, sheetId: string, q: RowQuery = { limit: 200 }) {
  return prismaRaw.$transaction(
    async (tx) => {
      await setTenantOnTx(tx, organizationId);
      const { sheet, columns } = await loadSheetColumnsTx(tx, organizationId, sheetId);
      const page = await queryRowsTx(tx, sheetId, columns, q);
      const refs = await referenceNamesTx(tx, organizationId, columns, page.rows);
      return { sheet, columns, page, refs };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

/** Nomes de referência para uma página já carregada (rota de consulta), numa transação só. */
export async function referenceNamesFast(organizationId: string, columns: { id: string; type: string }[], rows: { values: Record<string, CellValue> }[]) {
  const needs = columns.some((c) => c.type === "USER" || c.type === "CONTACT" || c.type === "DEAL");
  if (!needs || !rows.length) return {};
  return prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    return referenceNamesTx(tx, organizationId, columns, rows);
  });
}
