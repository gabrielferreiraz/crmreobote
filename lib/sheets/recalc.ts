/**
 * Recálculo de fórmulas no SERVIDOR, para escritas que não passam pela tela
 * (API v1, importação de arquivo). A tela continua recalculando sozinha a cada
 * edição; aqui é a mesma lógica (lib/sheets/formula.ts → recalcSheet) para que
 * quem lê pela API ou pelo /summary não receba resultado velho até alguém
 * abrir a planilha no navegador.
 */

import { Prisma } from "@/app/generated/prisma/client";
import { prismaRaw } from "@/lib/prisma";
import { setTenantOnTx } from "@/lib/tenant-context";
import type { CellValue } from "@/lib/sheets/column-types";
import { recalcSheet, scalarToStored } from "@/lib/sheets/formula";
import { referenceNames } from "@/lib/sheets/io";

/** Mesmo teto da tela: acima disto as fórmulas não são recalculadas. */
const MAX_CALC_ROWS = 20_000;

/** Recalcula e grava só os resultados que mudaram. Devolve quantas linhas mudaram (0 = sem fórmulas). */
export async function recalcSheetOnServer(organizationId: string, sheetId: string): Promise<number> {
  const loaded = await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    const hasFormulas = await tx.$queryRaw<{ any: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM "SheetRow" WHERE "sheetId" = ${sheetId} AND "deletedAt" IS NULL AND "formulas" <> '{}'::jsonb) AS "any"`;
    if (!hasFormulas[0]?.any) return null;
    const columns = await tx.sheetColumn.findMany({
      where: { sheetId, organizationId, archivedAt: null },
      orderBy: { position: "asc" },
      select: { id: true, name: true, type: true, config: true, required: true, position: true },
    });
    const rows = await tx.sheetRow.findMany({
      where: { sheetId, organizationId, deletedAt: null },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      take: MAX_CALC_ROWS,
      select: { id: true, values: true, formulas: true },
    });
    return { columns, rows };
  });
  if (!loaded) return 0;

  const rows = loaded.rows.map((r) => ({ id: r.id, values: r.values as Record<string, CellValue>, formulas: (r.formulas ?? {}) as Record<string, string> }));
  const refs = Object.fromEntries(await referenceNames(organizationId, loaded.columns, rows));
  const { results } = recalcSheet({ columns: loaded.columns.map((c) => ({ id: c.id, name: c.name, type: c.type })), rows, refs });

  const typeOf = new Map(loaded.columns.map((c) => [c.id, c.type]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const updates: { id: string; values: Record<string, CellValue> }[] = [];
  for (const [rowId, byCol] of results) {
    const row = byId.get(rowId)!;
    const next = { ...row.values };
    let changed = false;
    for (const [colId, result] of byCol) {
      const type = typeOf.get(colId);
      if (!type) continue;
      const { value } = scalarToStored(type, result);
      if (JSON.stringify(next[colId]) === JSON.stringify(value)) continue;
      changed = true;
      if (value === undefined) delete next[colId];
      else next[colId] = value;
    }
    if (changed) updates.push({ id: rowId, values: next });
  }
  if (!updates.length) return 0;

  await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    for (let i = 0; i < updates.length; i += 1000) {
      const chunk = updates.slice(i, i + 1000);
      const valuesSql = Prisma.join(chunk.map((u) => Prisma.sql`(${u.id}, ${JSON.stringify(u.values)}::jsonb)`));
      await tx.$executeRaw`
        UPDATE "SheetRow" AS r SET "values" = v.v, "updatedAt" = now()
        FROM (VALUES ${valuesSql}) AS v(id, v)
        WHERE r.id = v.id AND r."sheetId" = ${sheetId}`;
    }
  });
  return updates.length;
}

/** Para as rotas: recalcula sem nunca derrubar a escrita que já aconteceu. */
export async function recalcAfterWrite(organizationId: string, sheetId: string) {
  try {
    await recalcSheetOnServer(organizationId, sheetId);
  } catch (err) {
    console.error("[sheets] falha ao recalcular fórmulas", sheetId, err);
  }
}
