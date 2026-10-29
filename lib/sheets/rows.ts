/**
 * Linhas das Planilhas: leitura com filtro/ordenação/busca no banco e
 * escrita em lote (colar do Excel, importação, API). Toda escrita:
 * 1. coage cada célula pelo tipo da coluna (lib/sheets/column-types.ts);
 * 2. confere que USER/CONTACT/DEAL existem NESTA organização;
 * 3. mantém o índice reverso SheetRowLink e o histórico SheetActivity
 *    na MESMA transação — nunca fica uma linha gravada sem rastro.
 */

import { Prisma } from "@/app/generated/prisma/client";
import { prismaRaw } from "@/lib/prisma";
import { setTenantOnTx } from "@/lib/tenant-context";
import { SHEET_LIMITS } from "@/lib/sheets/limits";
import { SheetError, sheetNotFound } from "@/lib/sheets/errors";
import { columnSelect, type SheetActor, type SheetColumnRow } from "@/lib/sheets/sheets";
import { cellFormatSchema, cleanFormat, type RowFormats } from "@/lib/sheets/formats";
import { MAX_FORMULA_CHARS, NO_FORMULA_TYPES, remapFormulaRows, rowMapForInsertion, rowMapForRemoval, type RowMap } from "@/lib/sheets/formula";
import {
  CellValueError,
  coerceCellValue,
  coerceRowPatch,
  missingRequired,
  NUMERIC_TYPES,
  type CellValue,
} from "@/lib/sheets/column-types";

type Tx = Prisma.TransactionClient;
type Values = Record<string, CellValue>;

export type SheetRowOut = {
  id: string;
  values: Values;
  formats: RowFormats;
  formulas: Record<string, string>;
  position: number;
  /** Posição real (1 = primeira linha de dados) — é o número de linha do Excel (+1 do cabeçalho). */
  rank?: number;
  createdAt: Date;
  updatedAt: Date;
};

const ROW_SELECT = { id: true, values: true, formats: true, formulas: true, position: true, createdAt: true, updatedAt: true } as const;

/** Fórmula guardada: formato interno de lib/sheets/formula.ts; só confere o básico (o cálculo é da tela). */
function checkFormula(col: SheetColumnRow, raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("=") || raw.length < 2 || raw.length > MAX_FORMULA_CHARS) {
    throw new CellValueError(col.id, `"${col.name}": fórmula inválida`);
  }
  if (NO_FORMULA_TYPES.has(col.type)) throw new CellValueError(col.id, `"${col.name}": este tipo de coluna não aceita fórmula`);
  return raw;
}

const TX_OPTS = { timeout: 60_000, maxWait: 10_000 } as const;

/**
 * Planilha ativa + colunas ativas numa ÚNICA consulta (o banco é remoto: cada
 * ida e volta custa ~40 ms, e isto roda em toda leitura e escrita). Planilha
 * inexistente/arquivada/de outra organização = 404.
 */
export async function loadSheetColumnsTx(tx: Tx, organizationId: string, sheetId: string): Promise<{ sheet: SheetHead; columns: SheetColumnRow[] }> {
  const rows = await tx.$queryRaw<
    (SheetHead & { cid: string | null; cname: string | null; ctype: string | null; cconfig: unknown; crequired: boolean | null; cposition: number | null })[]
  >`
    SELECT s.id, s.name, s.description, s.settings, s."updatedAt",
           c.id AS cid, c.name AS cname, c.type::text AS ctype, c.config AS cconfig, c.required AS crequired, c.position AS cposition
    FROM "Sheet" s
    LEFT JOIN "SheetColumn" c ON c."sheetId" = s.id AND c."archivedAt" IS NULL
    WHERE s.id = ${sheetId} AND s."organizationId" = ${organizationId} AND s."archivedAt" IS NULL
    ORDER BY c.position ASC`;
  if (!rows.length) throw sheetNotFound();
  const { id, name, description, settings, updatedAt } = rows[0];
  const columns = rows
    .filter((r) => r.cid)
    .map((r) => ({
      id: r.cid!,
      name: r.cname!,
      type: r.ctype as SheetColumnRow["type"],
      config: r.cconfig as SheetColumnRow["config"],
      required: !!r.crequired,
      position: r.cposition!,
    }));
  return { sheet: { id, name, description, settings, updatedAt }, columns };
}

export type SheetHead = { id: string; name: string; description: string; settings: unknown; updatedAt: Date };

async function loadSheetForWrite(tx: Tx, organizationId: string, sheetId: string) {
  return (await loadSheetColumnsTx(tx, organizationId, sheetId)).columns;
}

/**
 * Confere existência das referências por tipo; lança SheetError com a linha
 * (rowIndex) na primeira que não existe — a importação usa isso para recusar
 * só aquela linha em vez do arquivo inteiro.
 */
async function assertReferences(tx: Tx, organizationId: string, columns: SheetColumnRow[], rows: Values[]) {
  type Ref = { columnId: string; rowIndex: number };
  const wanted = { USER: new Map<string, Ref>(), CONTACT: new Map<string, Ref>(), DEAL: new Map<string, Ref>() };
  for (const col of columns) {
    if (col.type !== "USER" && col.type !== "CONTACT" && col.type !== "DEAL") continue;
    const bucket = wanted[col.type];
    rows.forEach((r, rowIndex) => {
      const v = r[col.id];
      if (typeof v === "string" && !bucket.has(v)) bucket.set(v, { columnId: col.id, rowIndex });
    });
  }
  const check = async (ids: Map<string, Ref>, found: string[], label: string) => {
    const ok = new Set(found);
    for (const [id, ref] of ids) {
      if (!ok.has(id)) {
        const col = columns.find((c) => c.id === ref.columnId)!;
        throw new SheetError(400, `Linha ${ref.rowIndex + 1}: "${col.name}": ${label} não encontrado`, ref);
      }
    }
  };
  if (wanted.USER.size) {
    const found = await tx.organizationUser.findMany({ where: { organizationId, userId: { in: [...wanted.USER.keys()] } }, select: { userId: true } });
    await check(wanted.USER, found.map((f) => f.userId), "membro");
  }
  if (wanted.CONTACT.size) {
    const found = await tx.contact.findMany({ where: { organizationId, id: { in: [...wanted.CONTACT.keys()] } }, select: { id: true } });
    await check(wanted.CONTACT, found.map((f) => f.id), "cliente");
  }
  if (wanted.DEAL.size) {
    const found = await tx.deal.findMany({ where: { organizationId, id: { in: [...wanted.DEAL.keys()] } }, select: { id: true } });
    await check(wanted.DEAL, found.map((f) => f.id), "negócio");
  }
}

async function syncLinks(tx: Tx, organizationId: string, columns: SheetColumnRow[], rowId: string, values: Values) {
  const linkCols = columns.filter((c) => c.type === "CONTACT" || c.type === "DEAL");
  if (!linkCols.length) return;
  await tx.sheetRowLink.deleteMany({ where: { rowId, columnId: { in: linkCols.map((c) => c.id) } } });
  const data = linkCols
    .filter((c) => typeof values[c.id] === "string")
    .map((c) => ({
      organizationId,
      rowId,
      columnId: c.id,
      contactId: c.type === "CONTACT" ? (values[c.id] as string) : null,
      dealId: c.type === "DEAL" ? (values[c.id] as string) : null,
    }));
  if (data.length) await tx.sheetRowLink.createMany({ data });
}

function diff(before: Values, after: Values) {
  const changes: Record<string, [CellValue | null, CellValue | null]> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = [before[key] ?? null, after[key] ?? null];
  }
  return changes;
}

function coerceFullRow(columns: SheetColumnRow[], raw: Record<string, unknown>, index: number, hasFormulas = false): Values {
  try {
    const { set } = coerceRowPatch(columns, raw);
    const missing = hasFormulas ? null : missingRequired(columns, set);
    if (missing) throw new CellValueError(missing.id, `"${missing.name}" é obrigatório`);
    return set;
  } catch (err) {
    if (err instanceof CellValueError) throw new SheetError(400, `Linha ${index + 1}: ${err.message}`, { columnId: err.columnId, rowIndex: index });
    throw err;
  }
}

/** Insere linhas no fim da planilha. Retorna as linhas criadas (na ordem recebida). */
export async function insertRows(
  actor: SheetActor,
  sheetId: string,
  input: Record<string, unknown>[],
  /** Marcações/fórmulas das linhas novas (mesma ordem de `input`) — colar do Excel, digitar fórmula numa linha nova. */
  extras: ({ formats?: Record<string, unknown>; formulas?: Record<string, unknown> } | undefined)[] = [],
): Promise<SheetRowOut[]> {
  if (input.length === 0) return [];
  if (input.length > SHEET_LIMITS.batchRows) throw new SheetError(400, `Máximo de ${SHEET_LIMITS.batchRows} linhas por envio`);

  return prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, actor.organizationId);
    const columns = await loadSheetForWrite(tx, actor.organizationId, sheetId);
    const rows = input.map((r, i) => coerceFullRow(columns, r, i, !!extras[i]?.formulas && Object.keys(extras[i]!.formulas!).length > 0));
    await assertReferences(tx, actor.organizationId, columns, rows);
    const byId = new Map(columns.map((c) => [c.id, c]));
    const extraData = input.map((_, i) => {
      const e = extras[i];
      const formats: RowFormats = {};
      const formulas: Record<string, string> = {};
      try {
        for (const [colId, raw] of Object.entries(e?.formats ?? {})) {
          if (!byId.has(colId)) continue;
          const parsed = cellFormatSchema.safeParse(raw);
          const clean = parsed.success ? cleanFormat(parsed.data) : undefined;
          if (clean) formats[colId] = clean;
        }
        for (const [colId, raw] of Object.entries(e?.formulas ?? {})) {
          const col = byId.get(colId);
          if (col && raw !== null) formulas[colId] = checkFormula(col, raw);
        }
      } catch (err) {
        if (err instanceof CellValueError) throw new SheetError(400, `Linha ${i + 1}: ${err.message}`, { columnId: err.columnId, rowIndex: i });
        throw err;
      }
      return { formats, formulas };
    });

    const count = await tx.sheetRow.count({ where: { sheetId, deletedAt: null } });
    if (count + rows.length > SHEET_LIMITS.rowsPerSheet) throw new SheetError(400, `Limite de ${SHEET_LIMITS.rowsPerSheet} linhas por planilha`);
    const last = await tx.sheetRow.aggregate({ where: { sheetId }, _max: { position: true } });
    const base = (last._max.position ?? 0) + 1;

    const created = await tx.sheetRow.createManyAndReturn({
      data: rows.map((values, i) => ({
        organizationId: actor.organizationId,
        sheetId,
        values,
        formats: extraData[i].formats as Prisma.InputJsonValue,
        formulas: extraData[i].formulas as Prisma.InputJsonValue,
        position: base + i,
        createdById: actor.userId,
        updatedById: actor.userId,
      })),
      select: ROW_SELECT,
    });
    created.sort((a, b) => a.position - b.position);
    for (const r of created) await syncLinks(tx, actor.organizationId, columns, r.id, r.values as Values);
    await tx.sheetActivity.createMany({
      data: created.map((r) => ({
        organizationId: actor.organizationId,
        sheetId,
        rowId: r.id,
        userId: actor.userId,
        source: actor.source,
        action: "ROW_CREATED",
        changes: diff({}, r.values as Values),
      })),
    });
    await tx.sheet.update({ where: { id: sheetId }, data: { updatedById: actor.userId } });
    return created as SheetRowOut[];
  }, TX_OPTS);
}

/**
 * Atualização parcial em lote: `values` traz só as células que mudaram
 * (null/"" = esvaziar) e `formats` só as marcações que mudaram (null = tirar
 * a formatação da célula). Linhas sem mudança real não geram histórico.
 */
export async function updateRows(
  actor: SheetActor,
  sheetId: string,
  updates: { id: string; values?: Record<string, unknown>; formats?: Record<string, unknown>; formulas?: Record<string, unknown> }[],
): Promise<SheetRowOut[]> {
  if (updates.length === 0) return [];
  if (updates.length > SHEET_LIMITS.batchRows) throw new SheetError(400, `Máximo de ${SHEET_LIMITS.batchRows} linhas por envio`);

  return prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, actor.organizationId);
    const columns = await loadSheetForWrite(tx, actor.organizationId, sheetId);
    const colIds = new Set(columns.map((c) => c.id));
    const ids = [...new Set(updates.map((u) => u.id))];
    const existing = await tx.sheetRow.findMany({
      where: { id: { in: ids }, sheetId, deletedAt: null },
      select: { id: true, values: true, formats: true, formulas: true },
    });
    const byId = new Map(
      existing.map((r) => [r.id, { values: r.values as Values, formats: (r.formats ?? {}) as RowFormats, formulas: (r.formulas ?? {}) as Record<string, string> }]),
    );
    const colById = new Map(columns.map((c) => [c.id, c]));

    type State = { values: Values; formats: RowFormats; formulas: Record<string, string> };
    const finals = new Map<string, { before: State; after: State }>();
    updates.forEach((u, i) => {
      const before = finals.get(u.id)?.after ?? byId.get(u.id);
      if (!before) throw new SheetError(404, `Linha ${i + 1}: não encontrada (pode ter sido excluída)`);
      try {
        const { set, unset } = coerceRowPatch(columns, u.values ?? {});
        const values: Values = { ...before.values, ...set };
        for (const k of unset) delete values[k];
        const formulas: Record<string, string> = { ...before.formulas };
        for (const [colId, raw] of Object.entries(u.formulas ?? {})) {
          const col = colById.get(colId);
          if (!col) throw new CellValueError(colId, "Coluna inexistente ou arquivada");
          if (raw === null) delete formulas[colId];
          else formulas[colId] = checkFormula(col, raw);
        }
        // Célula com fórmula cujo resultado não cabe no tipo fica vazia: a obrigatoriedade não trava a fórmula.
        const missing = missingRequired(
          columns.filter((c) => !formulas[c.id]),
          values,
        );
        if (missing) throw new CellValueError(missing.id, `"${missing.name}" é obrigatório`);
        const formats: RowFormats = { ...before.formats };
        for (const [colId, raw] of Object.entries(u.formats ?? {})) {
          if (!colIds.has(colId)) throw new CellValueError(colId, "Coluna inexistente ou arquivada");
          if (raw === null) {
            delete formats[colId];
            continue;
          }
          const parsed = cellFormatSchema.safeParse(raw);
          if (!parsed.success) throw new CellValueError(colId, "Formatação inválida");
          const clean = cleanFormat(parsed.data);
          if (clean) formats[colId] = clean;
          else delete formats[colId];
        }
        finals.set(u.id, { before: finals.get(u.id)?.before ?? before, after: { values, formats, formulas } });
      } catch (err) {
        if (err instanceof CellValueError) throw new SheetError(400, `Linha ${i + 1}: ${err.message}`, { columnId: err.columnId, rowId: u.id });
        throw err;
      }
    });

    const changed = [...finals].filter(
      ([, f]) =>
        Object.keys(diff(f.before.values, f.after.values)).length > 0 ||
        JSON.stringify(f.before.formats) !== JSON.stringify(f.after.formats) ||
        JSON.stringify(f.before.formulas) !== JSON.stringify(f.after.formulas),
    );
    await assertReferences(tx, actor.organizationId, columns, changed.map(([, f]) => f.after.values));

    const out: SheetRowOut[] = [];
    for (const [id, f] of changed) {
      const row = await tx.sheetRow.update({
        where: { id },
        data: {
          values: f.after.values,
          formats: f.after.formats as Prisma.InputJsonValue,
          formulas: f.after.formulas as Prisma.InputJsonValue,
          updatedById: actor.userId,
        },
        select: ROW_SELECT,
      });
      await syncLinks(tx, actor.organizationId, columns, id, f.after.values);
      out.push(row as SheetRowOut);
    }
    if (changed.length) {
      await tx.sheetActivity.createMany({
        data: changed.flatMap(([id, f]) => {
          const valueChanges = diff(f.before.values, f.after.values);
          const formatChanges = Object.fromEntries(
            [...new Set([...Object.keys(f.before.formats), ...Object.keys(f.after.formats)])]
              .filter((k) => JSON.stringify(f.before.formats[k]) !== JSON.stringify(f.after.formats[k]))
              .map((k) => [k, [f.before.formats[k] ?? null, f.after.formats[k] ?? null]]),
          );
          const formulaChanges = Object.fromEntries(
            [...new Set([...Object.keys(f.before.formulas), ...Object.keys(f.after.formulas)])]
              .filter((k) => f.before.formulas[k] !== f.after.formulas[k])
              .map((k) => [k, [f.before.formulas[k] ?? null, f.after.formulas[k] ?? null]]),
          );
          const base = { organizationId: actor.organizationId, sheetId, rowId: id, userId: actor.userId, source: actor.source };
          return [
            ...(Object.keys(valueChanges).length ? [{ ...base, action: "ROW_UPDATED", changes: valueChanges }] : []),
            ...(Object.keys(formatChanges).length ? [{ ...base, action: "ROW_FORMATTED", changes: formatChanges }] : []),
            ...(Object.keys(formulaChanges).length ? [{ ...base, action: "ROW_FORMULA", changes: formulaChanges }] : []),
          ];
        }),
      });
      await tx.sheet.update({ where: { id: sheetId }, data: { updatedById: actor.userId } });
    }
    return out;
  }, TX_OPTS);
}

export type FormulaChange = { rowId: string; colId: string; before: string; after: string };

/**
 * Reescreve as fórmulas das linhas que ficam quando outras saem/voltam — como
 * o Excel ao excluir/inserir linhas: referência abaixo sobe/desce, referência
 * à linha excluída vira #REF!, intervalo encolhe. Um UPDATE por lote.
 */
async function remapSheetFormulas(
  tx: Tx,
  sheetId: string,
  before: { id: string; formulas: Record<string, string> }[],
  after: { id: string; formulas: Record<string, string> }[],
  map: RowMap,
  skip: Set<string>,
): Promise<FormulaChange[]> {
  const beforeRank = new Map(before.map((r, i) => [r.id, i + 1]));
  const changes: FormulaChange[] = [];
  const updates: { id: string; formulas: Record<string, string> }[] = [];
  after.forEach((row, i) => {
    if (skip.has(row.id) || !Object.keys(row.formulas).length) return;
    const ownBefore = (beforeRank.get(row.id) ?? i + 1) + 1;
    const ownAfter = i + 2;
    const next: Record<string, string> = {};
    let changed = false;
    for (const [colId, f] of Object.entries(row.formulas)) {
      const g = remapFormulaRows(f, ownBefore, ownAfter, map);
      next[colId] = g;
      if (g !== f) {
        changed = true;
        changes.push({ rowId: row.id, colId, before: f, after: g });
      }
    }
    if (changed) updates.push({ id: row.id, formulas: next });
  });
  for (let i = 0; i < updates.length; i += 1000) {
    const chunk = updates.slice(i, i + 1000);
    const valuesSql = Prisma.join(chunk.map((u) => Prisma.sql`(${u.id}, ${JSON.stringify(u.formulas)}::jsonb)`));
    await tx.$executeRaw`
      UPDATE "SheetRow" AS r SET "formulas" = v.f, "updatedAt" = now()
      FROM (VALUES ${valuesSql}) AS v(id, f)
      WHERE r.id = v.id AND r."sheetId" = ${sheetId}`;
  }
  return changes;
}

/** Exclusão reversível (lixeira). Vínculos saem junto para a linha sumir da ficha do cliente. */
export async function setRowsDeleted(actor: SheetActor, sheetId: string, ids: string[], deleted: boolean): Promise<number> {
  return (await setRowsDeletedDetailed(actor, sheetId, ids, deleted)).count;
}

/** Igual a setRowsDeleted, devolvendo também as fórmulas reescritas (para o Ctrl+Z voltar exatamente). */
export async function setRowsDeletedDetailed(
  actor: SheetActor,
  sheetId: string,
  ids: string[],
  deleted: boolean,
): Promise<{ count: number; formulaChanges: FormulaChange[] }> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { count: 0, formulaChanges: [] };
  if (unique.length > SHEET_LIMITS.batchRows) throw new SheetError(400, `Máximo de ${SHEET_LIMITS.batchRows} linhas por envio`);

  return prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, actor.organizationId);
    const columns = await loadSheetForWrite(tx, actor.organizationId, sheetId);
    const rows = await tx.sheetRow.findMany({
      where: { id: { in: unique }, sheetId, deletedAt: deleted ? null : { not: null } },
      select: { id: true, values: true },
    });
    if (!rows.length) return { count: 0, formulaChanges: [] };
    const liveBefore = await tx.sheetRow.findMany({
      where: { sheetId, deletedAt: null },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true, formulas: true, position: true },
    });
    if (!deleted) {
      const count = await tx.sheetRow.count({ where: { sheetId, deletedAt: null } });
      if (count + rows.length > SHEET_LIMITS.rowsPerSheet) throw new SheetError(400, `Limite de ${SHEET_LIMITS.rowsPerSheet} linhas por planilha`);
    }
    await tx.sheetRow.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { deletedAt: deleted ? new Date() : null, updatedById: actor.userId } });

    let formulaChanges: FormulaChange[] = [];
    const affected = new Set(rows.map((r) => r.id));
    const asList = (list: { id: string; formulas: unknown }[]) => list.map((r) => ({ id: r.id, formulas: (r.formulas ?? {}) as Record<string, string> }));
    if (liveBefore.some((r) => Object.keys((r.formulas ?? {}) as object).length)) {
      const liveAfter = await tx.sheetRow.findMany({
        where: { sheetId, deletedAt: null },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { id: true, formulas: true },
      });
      if (deleted) {
        const removed = new Set(liveBefore.flatMap((r, i) => (affected.has(r.id) ? [i + 1] : [])));
        formulaChanges = await remapSheetFormulas(tx, sheetId, asList(liveBefore), asList(liveAfter), rowMapForRemoval(liveBefore.length, removed), affected);
      } else {
        const inserted = new Set(liveAfter.flatMap((r, i) => (affected.has(r.id) ? [i + 1] : [])));
        formulaChanges = await remapSheetFormulas(tx, sheetId, asList(liveBefore), asList(liveAfter), rowMapForInsertion(inserted), affected);
      }
    }
    if (deleted) await tx.sheetRowLink.deleteMany({ where: { rowId: { in: rows.map((r) => r.id) } } });
    else for (const r of rows) await syncLinks(tx, actor.organizationId, columns, r.id, r.values as Values);
    await tx.sheetActivity.createMany({
      data: rows.map((r) => ({
        organizationId: actor.organizationId,
        sheetId,
        rowId: r.id,
        userId: actor.userId,
        source: actor.source,
        action: deleted ? "ROW_DELETED" : "ROW_RESTORED",
      })),
    });
    await tx.sheet.update({ where: { id: sheetId }, data: { updatedById: actor.userId } });
    return { count: rows.length, formulaChanges };
  }, TX_OPTS);
}

// ─── Leitura ─────────────────────────────────────────────────────────

export const FILTER_OPS = ["eq", "neq", "contains", "notContains", "gt", "gte", "lt", "lte", "empty", "notEmpty", "in"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];
export type RowFilter = { columnId: string; op: FilterOp; value?: unknown };
export type RowSort = { columnId: string; dir: "asc" | "desc" };

export type RowQuery = {
  filters?: RowFilter[];
  /** Todas as condições (and) ou qualquer uma (or). */
  match?: "all" | "any";
  sort?: RowSort[];
  search?: string;
  offset?: number;
  limit?: number;
  deleted?: boolean;
};

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Expressão SQL do valor da coluna, já no tipo certo para comparar/ordenar. */
function typedValue(col: SheetColumnRow): Prisma.Sql {
  if (NUMERIC_TYPES.has(col.type)) return Prisma.sql`(r."values" ->> ${col.id})::numeric`;
  if (col.type === "CHECKBOX") return Prisma.sql`(r."values" ->> ${col.id})::boolean`;
  return Prisma.sql`(r."values" ->> ${col.id})`;
}

/**
 * Monta o WHERE de um filtro. Ids de coluna e valores vão SEMPRE como
 * parâmetro ($1, $2…), nunca concatenados — a coluna é conferida contra a
 * planilha antes, e o valor passa pela mesma coerção da escrita.
 */
function filterSql(col: SheetColumnRow, f: RowFilter): Prisma.Sql {
  const key = col.id;
  const v = typedValue(col);
  const coerce = (raw: unknown) => {
    try {
      // Filtro de SELECT com valor fora das opções não é erro: só não encontra nada.
      const probe = col.type === "SELECT" || col.type === "MULTI_SELECT" ? { ...col, type: "TEXT" as const } : col;
      return coerceCellValue(probe, raw);
    } catch (err) {
      if (err instanceof CellValueError) throw new SheetError(400, `Filtro inválido — ${err.message}`);
      throw err;
    }
  };
  switch (f.op) {
    case "empty":
      return Prisma.sql`NOT (r."values" ? ${key})`;
    case "notEmpty":
      return Prisma.sql`(r."values" ? ${key})`;
    case "contains":
    case "notContains": {
      const s = `%${escapeLike(String(f.value ?? ""))}%`;
      const like = Prisma.sql`(r."values" ->> ${key}) ILIKE ${s}`;
      return f.op === "contains" ? like : Prisma.sql`NOT COALESCE(${like}, false)`;
    }
    case "in": {
      // Lista do AutoFiltro: `null` na lista = "(Vazias)". Em MULTI_SELECT, cada
      // opção casa se estiver DENTRO da lista da célula (containment de array).
      const raw = Array.isArray(f.value) ? f.value : [f.value];
      const wantsEmpty = raw.some((x) => x === null || x === "");
      const list = raw.filter((x) => x !== null && x !== "").map(coerce).filter((x) => x !== undefined);
      const parts = list.map((x) => {
        const json = col.type === "MULTI_SELECT" ? JSON.stringify(Array.isArray(x) ? x : [x]) : JSON.stringify(x);
        return Prisma.sql`r."values" @> jsonb_build_object(${key}::text, ${json}::jsonb)`;
      });
      if (wantsEmpty) parts.push(Prisma.sql`NOT (r."values" ? ${key})`);
      if (!parts.length) return Prisma.sql`false`;
      return Prisma.sql`(${Prisma.join(parts, " OR ")})`;
    }
    case "eq":
    case "neq": {
      const x = coerce(f.value);
      if (x === undefined) return f.op === "eq" ? Prisma.sql`NOT (r."values" ? ${key})` : Prisma.sql`(r."values" ? ${key})`;
      // MULTI_SELECT: "eq" = contém a opção.
      const json = col.type === "MULTI_SELECT" ? JSON.stringify(Array.isArray(x) ? x : [x]) : JSON.stringify(x);
      const hit = Prisma.sql`r."values" @> jsonb_build_object(${key}::text, ${json}::jsonb)`;
      return f.op === "eq" ? hit : Prisma.sql`NOT (${hit})`;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (!NUMERIC_TYPES.has(col.type) && col.type !== "DATE") throw new SheetError(400, `Filtro "${f.op}" só vale para número e data`);
      const x = coerce(f.value);
      if (x === undefined) throw new SheetError(400, "Filtro sem valor");
      const param = NUMERIC_TYPES.has(col.type) ? Prisma.sql`${x}::numeric` : Prisma.sql`${x}::text`;
      const op = { gt: Prisma.sql`>`, gte: Prisma.sql`>=`, lt: Prisma.sql`<`, lte: Prisma.sql`<=` }[f.op];
      return Prisma.sql`${v} ${op} ${param}`;
    }
  }
}

function whereSql(sheetId: string, columns: SheetColumnRow[], q: RowQuery): Prisma.Sql {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const parts: Prisma.Sql[] = [Prisma.sql`r."sheetId" = ${sheetId}`, q.deleted ? Prisma.sql`r."deletedAt" IS NOT NULL` : Prisma.sql`r."deletedAt" IS NULL`];
  const filters = (q.filters ?? []).map((f) => {
    const col = byId.get(f.columnId);
    if (!col) throw new SheetError(400, "Filtro com coluna inexistente");
    if (!FILTER_OPS.includes(f.op)) throw new SheetError(400, "Operação de filtro inválida");
    return filterSql(col, f);
  });
  if (filters.length) parts.push(Prisma.sql`(${Prisma.join(filters, q.match === "any" ? " OR " : " AND ")})`);
  const search = q.search?.trim();
  if (search) {
    const s = `%${escapeLike(search.slice(0, 200))}%`;
    // Busca só nos VALORES das colunas ativas (nunca nas chaves/ids).
    parts.push(Prisma.sql`EXISTS (SELECT 1 FROM jsonb_each_text(r."values") e WHERE e.key = ANY(${columns.map((c) => c.id)}::text[]) AND e.value ILIKE ${s})`);
  }
  return Prisma.join(parts, " AND ");
}

export type RowsPage = {
  columns: SheetColumnRow[];
  rows: SheetRowOut[];
  total: number;
  /** Linhas da planilha sem filtro (numeração das linhas novas continua daqui). */
  allTotal: number;
  hasFormulas: boolean;
  offset: number;
  limit: number;
};

export async function queryRows(organizationId: string, sheetId: string, q: RowQuery = {}): Promise<RowsPage> {
  return prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    const columns = await loadSheetForWrite(tx, organizationId, sheetId);
    return queryRowsTx(tx, sheetId, columns, q);
  }, TX_OPTS);
}

/**
 * Uma página de linhas num ÚNICO comando SQL: linhas + total filtrado
 * (COUNT(*) OVER, antes do LIMIT) + total da planilha + "tem fórmula?". Antes
 * eram três consultas separadas — cada uma uma ida e volta ao banco.
 */
export async function queryRowsTx(tx: Tx, sheetId: string, columns: SheetColumnRow[], q: RowQuery = {}): Promise<RowsPage> {
  const limit = Math.max(1, Math.min(q.limit ?? 100, SHEET_LIMITS.pageSizeMax));
  const offset = Math.max(0, Math.floor(q.offset ?? 0));
  if ((q.filters?.length ?? 0) > 30 || (q.sort?.length ?? 0) > 5) throw new SheetError(400, "Filtros/ordenações demais");

  const byId = new Map(columns.map((c) => [c.id, c]));
  const where = whereSql(sheetId, columns, q);
  const order = (q.sort ?? []).map((s) => {
    const col = byId.get(s.columnId);
    if (!col) throw new SheetError(400, "Ordenação com coluna inexistente");
    return s.dir === "desc" ? Prisma.sql`${typedValue(col)} DESC NULLS LAST` : Prisma.sql`${typedValue(col)} ASC NULLS LAST`;
  });
  order.push(Prisma.sql`r.position ASC`, Prisma.sql`r.id ASC`);
  const orderSql = Prisma.join(order, ", ");

  // rank = posição real da linha entre as não excluídas (é o número de linha do Excel, que não muda
  // com filtro nem ordenação — o Excel também mantém o número original das linhas filtradas).
  // `meta LEFT JOIN LATERAL`: sempre volta ao menos uma linha, então os totais chegam mesmo sem resultado.
  const result = await tx.$queryRaw<
    {
      all: bigint;
      anyFormula: boolean;
      id: string | null;
      values: Values;
      formats: RowFormats | null;
      rowFormulas: Record<string, string> | null;
      position: number;
      createdAt: Date;
      updatedAt: Date;
      rank: bigint | null;
      total: bigint | null;
    }[]
  >`
    WITH meta AS (
      SELECT COUNT(*)::bigint AS "all", COALESCE(bool_or("formulas" <> '{}'::jsonb), false) AS "anyFormula"
      FROM "SheetRow" WHERE "sheetId" = ${sheetId} AND "deletedAt" IS NULL
    ),
    -- Número da linha (rank) calculado na MESMA varredura que filtra/ordena — sem junção: com a
    -- tabela recém-preenchida o Postgres estimava 1 linha e comparava 600 mil pares (230 ms).
    -- A janela fica na subconsulta, antes do filtro: o rank é da planilha inteira, não do filtrado.
    -- Só id + ordem + total saem daqui; o JSON das células é lido depois, só para a página.
    pick AS (
      SELECT r.id, r.rank, COUNT(*) OVER () AS total, ROW_NUMBER() OVER (ORDER BY ${orderSql}) AS ord
      FROM (
        SELECT s0.*,
               CASE WHEN s0."deletedAt" IS NULL
                    THEN ROW_NUMBER() OVER (PARTITION BY (s0."deletedAt" IS NULL) ORDER BY s0.position, s0.id) END AS rank
        FROM "SheetRow" s0 WHERE s0."sheetId" = ${sheetId}
      ) r
      WHERE ${where}
      ORDER BY ${orderSql}
      LIMIT ${limit} OFFSET ${offset}
    )
    SELECT meta."all", meta."anyFormula", p.*
    FROM meta LEFT JOIN LATERAL (
      SELECT x.id, x."values", x."formats", x."formulas" AS "rowFormulas", x.position, x."createdAt", x."updatedAt", pick.rank, pick.total, pick.ord
      FROM pick JOIN "SheetRow" x ON x.id = pick.id
    ) p ON true
    ORDER BY p.ord`;

  const head = result[0];
  const found = result.filter((r) => r.id);
  let total = found.length ? Number(found[0].total ?? 0) : 0;
  // Página além do fim (rolou demais): o total sai numa consulta à parte, só nesse caso raro.
  if (!found.length && offset > 0) {
    total = Number((await tx.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "SheetRow" r WHERE ${where}`)[0]?.n ?? 0);
  }
  // Coluna arquivada continua no JSON (para poder restaurar), mas não sai na leitura.
  const active = new Set(columns.map((c) => c.id));
  const rows: SheetRowOut[] = found.map((r) => {
    const values = { ...r.values };
    for (const k of Object.keys(values)) if (!active.has(k)) delete values[k];
    const formats = { ...(r.formats ?? {}) };
    for (const k of Object.keys(formats)) if (!active.has(k)) delete formats[k];
    const formulas = { ...(r.rowFormulas ?? {}) };
    for (const k of Object.keys(formulas)) if (!active.has(k)) delete formulas[k];
    return {
      id: r.id!,
      values,
      formats,
      formulas,
      position: r.position,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      rank: r.rank === null ? undefined : Number(r.rank),
    };
  });
  return { columns, rows, total, allTotal: Number(head?.all ?? 0), hasFormulas: !!head?.anyFormula, offset, limit };
}

/**
 * A planilha inteira, compacta, na ordem real — só o que o motor de fórmulas
 * precisa (id, valores, fórmulas, posição). Um comando só, em vez de páginas.
 */
export async function allRowsForCalc(organizationId: string, sheetId: string, max = 20_000) {
  return prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    const columns = await loadSheetForWrite(tx, organizationId, sheetId);
    const rows = await tx.$queryRaw<{ id: string; values: Values; formulas: Record<string, string> | null; rank: bigint }[]>`
      SELECT id, "values", "formulas", ROW_NUMBER() OVER (ORDER BY position, id) AS rank
      FROM "SheetRow" WHERE "sheetId" = ${sheetId} AND "deletedAt" IS NULL
      ORDER BY position, id
      LIMIT ${max}`;
    return { columns, rows: rows.map((r) => ({ id: r.id, values: r.values, formulas: r.formulas ?? {}, rank: Number(r.rank) })) };
  }, TX_OPTS);
}

// ─── Resumos (relatórios) ────────────────────────────────────────────

export const AGG_FNS = ["count", "sum", "avg", "min", "max", "countFilled"] as const;
export type AggFn = (typeof AGG_FNS)[number];

/**
 * Agrupa e agrega no banco: "quantos por status", "soma do valor por
 * responsável". Sem groupBy = uma linha só com os totais. Até 500 grupos.
 */
export async function summarizeRows(
  organizationId: string,
  sheetId: string,
  input: { groupBy?: string; metrics: { columnId?: string; fn: AggFn }[]; filters?: RowFilter[]; match?: "all" | "any" },
) {
  if (!input.metrics.length || input.metrics.length > 10) throw new SheetError(400, "Informe de 1 a 10 métricas");
  return prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    const columns = await loadSheetForWrite(tx, organizationId, sheetId);
    const byId = new Map(columns.map((c) => [c.id, c]));
    const where = whereSql(sheetId, columns, { filters: input.filters, match: input.match });

    const metricSql = input.metrics.map((m, i) => {
      const alias = Prisma.raw(`"m${i}"`);
      if (m.fn === "count") return Prisma.sql`COUNT(*)::float8 AS ${alias}`;
      const col = m.columnId ? byId.get(m.columnId) : undefined;
      if (!col) throw new SheetError(400, `Métrica ${i + 1}: coluna inexistente`);
      if (m.fn === "countFilled") return Prisma.sql`COUNT(*) FILTER (WHERE r."values" ? ${col.id})::float8 AS ${alias}`;
      if (!NUMERIC_TYPES.has(col.type) && !(col.type === "DATE" && (m.fn === "min" || m.fn === "max"))) {
        throw new SheetError(400, `"${col.name}" não é numérica`);
      }
      const fn = Prisma.raw({ sum: "SUM", avg: "AVG", min: "MIN", max: "MAX" }[m.fn]);
      const expr = col.type === "DATE" ? typedValue(col) : Prisma.sql`${typedValue(col)}::float8`;
      return Prisma.sql`${fn}(${expr}) AS ${alias}`;
    });

    let groupExpr: Prisma.Sql | null = null;
    if (input.groupBy) {
      const g = byId.get(input.groupBy);
      if (!g) throw new SheetError(400, "Agrupamento com coluna inexistente");
      // MULTI_SELECT: cada opção conta no seu grupo.
      groupExpr =
        g.type === "MULTI_SELECT"
          ? Prisma.sql`jsonb_array_elements_text(COALESCE(r."values" -> ${g.id}, '[]'::jsonb))`
          : Prisma.sql`(r."values" ->> ${g.id})`;
    }

    const rows = groupExpr
      ? await tx.$queryRaw<Record<string, unknown>[]>`
          SELECT ${groupExpr} AS "group", ${Prisma.join(metricSql, ", ")}
          FROM "SheetRow" r WHERE ${where}
          GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 500`
      : await tx.$queryRaw<Record<string, unknown>[]>`
          SELECT NULL AS "group", ${Prisma.join(metricSql, ", ")} FROM "SheetRow" r WHERE ${where}`;

    return rows.map((r) => ({
      group: (r.group as string | null) ?? null,
      values: input.metrics.map((_, i) => {
        const v = r[`m${i}`];
        return v === null || v === undefined ? null : typeof v === "number" || typeof v === "string" ? v : Number(v);
      }),
    }));
  }, TX_OPTS);
}

// ─── Integração com o resto do CRM ───────────────────────────────────

/** "Este cliente/negócio aparece em quais planilhas?" — para a ficha do cliente e para a API. */
export async function linkedRows(organizationId: string, target: { contactId: string } | { dealId: string }) {
  return prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    const links = await tx.sheetRowLink.findMany({
      where: { organizationId, ...target, row: { deletedAt: null, sheet: { archivedAt: null } } },
      take: 500,
      orderBy: { createdAt: "desc" },
      select: {
        columnId: true,
        row: {
          select: {
            id: true,
            values: true,
            updatedAt: true,
            sheet: { select: { id: true, name: true, columns: { where: { archivedAt: null }, orderBy: { position: "asc" }, select: columnSelect } } },
          },
        },
      },
    });
    const bySheet = new Map<string, { sheet: { id: string; name: string }; columns: SheetColumnRow[]; rows: { id: string; values: Values; updatedAt: Date; viaColumnId: string }[] }>();
    for (const l of links) {
      const s = l.row.sheet;
      const entry = bySheet.get(s.id) ?? { sheet: { id: s.id, name: s.name }, columns: s.columns, rows: [] };
      if (!entry.rows.some((r) => r.id === l.row.id)) entry.rows.push({ id: l.row.id, values: l.row.values as Values, updatedAt: l.row.updatedAt, viaColumnId: l.columnId });
      bySheet.set(s.id, entry);
    }
    return [...bySheet.values()];
  }, TX_OPTS);
}

export async function rowHistory(organizationId: string, sheetId: string, opts: { rowId?: string; limit?: number } = {}) {
  return prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    const exists = await tx.sheet.findFirst({ where: { id: sheetId, organizationId }, select: { id: true } });
    if (!exists) throw sheetNotFound();
    const items = await tx.sheetActivity.findMany({
      where: { sheetId, organizationId, ...(opts.rowId ? { rowId: opts.rowId } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: Math.min(opts.limit ?? 100, 500),
      select: { id: true, rowId: true, userId: true, source: true, action: true, changes: true, createdAt: true },
    });
    const userIds = [...new Set(items.map((i) => i.userId).filter((x): x is string => !!x))];
    const users = userIds.length ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return items.map((i) => ({ ...i, userName: i.userId ? (names.get(i.userId) ?? null) : null }));
  }, TX_OPTS);
}
