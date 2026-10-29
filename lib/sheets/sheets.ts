/**
 * Planilhas e colunas (estrutura). Toda função recebe o `actor` já
 * autorizado (tela: lib/sheets/access.ts; integração: API key) e roda
 * dentro do tenant — RLS é a segunda camada, o `where organizationId` a primeira.
 */

import { Prisma } from "@/app/generated/prisma/client";
import { prisma, prismaRaw } from "@/lib/prisma";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { SHEET_LIMITS } from "@/lib/sheets/limits";
import { SheetError, sheetNotFound } from "@/lib/sheets/errors";
import { sheetSettingsSchema } from "@/lib/sheets/formats";
import { NO_FORMULA_TYPES } from "@/lib/sheets/formula";
import {
  CellValueError,
  coerceCellValue,
  normalizeColumnConfig,
  REFERENCE_TYPES,
  type SheetColumnType,
} from "@/lib/sheets/column-types";

export type SheetActor = {
  organizationId: string;
  userId: string | null;
  actorName: string;
  /** "app" (tela) ou "api:<apiKeyId>" (integração) — vai para SheetActivity.source. */
  source: string;
};

export const columnSelect = {
  id: true,
  name: true,
  type: true,
  config: true,
  required: true,
  position: true,
} satisfies Prisma.SheetColumnSelect;

export type SheetColumnRow = Prisma.SheetColumnGetPayload<{ select: typeof columnSelect }>;

export async function listSheets(organizationId: string, opts: { archived?: boolean } = {}) {
  return runWithTenant(organizationId, async () => {
    const sheets = await prisma.sheet.findMany({
      where: { organizationId, archivedAt: opts.archived ? { not: null } : null },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, description: true, archivedAt: true, createdAt: true, updatedAt: true },
    });
    const counts = await prisma.sheetRow.groupBy({
      by: ["sheetId"],
      where: { organizationId, deletedAt: null, sheetId: { in: sheets.map((s) => s.id) } },
      _count: { _all: true },
    });
    const byId = new Map(counts.map((c) => [c.sheetId, c._count._all]));
    return sheets.map((s) => ({ ...s, rowCount: byId.get(s.id) ?? 0 }));
  });
}

/** Planilha ativa + colunas ativas em ordem. `includeArchived` só para restaurar. */
export async function getSheet(organizationId: string, sheetId: string, opts: { includeArchived?: boolean } = {}) {
  const sheet = await runWithTenant(organizationId, () =>
    prisma.sheet.findFirst({
      where: { id: sheetId, organizationId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
      select: {
        id: true,
        name: true,
        description: true,
        settings: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
        columns: { where: { archivedAt: null }, orderBy: { position: "asc" }, select: columnSelect },
      },
    }),
  );
  if (!sheet) throw sheetNotFound();
  return sheet;
}

export type ColumnInput = {
  name: string;
  type: SheetColumnType;
  config?: unknown;
  required?: boolean;
};

/** Coluna pode ficar SEM título (como no Excel, onde a coluna é só a letra); só limita o tamanho. */
function checkColumnName(name: string) {
  const n = name.trim();
  if (n.length > SHEET_LIMITS.nameChars) throw new SheetError(400, "Nome da coluna muito longo");
  return n;
}

function checkName(name: string, what: string) {
  const n = name.trim();
  if (!n) throw new SheetError(400, `Informe o nome da ${what}`);
  if (n.length > SHEET_LIMITS.nameChars) throw new SheetError(400, `Nome da ${what} muito longo`);
  return n;
}

function columnData(input: ColumnInput) {
  const cfg = normalizeColumnConfig(input.type, input.config);
  if (!cfg.ok) throw new SheetError(400, cfg.error);
  return {
    name: checkColumnName(input.name),
    type: input.type,
    config: cfg.config as Prisma.InputJsonValue,
    required: input.required ?? false,
  };
}

export async function createSheet(actor: SheetActor, input: { name: string; description?: string; columns?: ColumnInput[] }) {
  const name = checkName(input.name, "planilha");
  const description = (input.description ?? "").trim().slice(0, SHEET_LIMITS.descriptionChars);
  // Como no Excel: planilha nova nasce em branco (colunas A…Z vazias na tela); a coluna
  // é criada quando alguém digita nela.
  const columns = (input.columns ?? []).map(columnData);
  if (columns.length > SHEET_LIMITS.columnsPerSheet) throw new SheetError(400, `Máximo de ${SHEET_LIMITS.columnsPerSheet} colunas`);

  return prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, actor.organizationId);
    const total = await tx.sheet.count({ where: { organizationId: actor.organizationId, archivedAt: null } });
    if (total >= SHEET_LIMITS.sheetsPerOrg) throw new SheetError(400, `Limite de ${SHEET_LIMITS.sheetsPerOrg} planilhas atingido — arquive as que não usa mais`);

    const sheet = await tx.sheet.create({
      data: {
        organizationId: actor.organizationId,
        name,
        description,
        createdById: actor.userId,
        updatedById: actor.userId,
        columns: { create: columns.map((c, i) => ({ ...c, organizationId: actor.organizationId, position: i })) },
      },
      select: { id: true },
    });
    await tx.sheetActivity.create({
      data: { organizationId: actor.organizationId, sheetId: sheet.id, userId: actor.userId, source: actor.source, action: "SHEET_CREATED", changes: { name } },
    });
    return sheet;
  });
}

export async function updateSheet(actor: SheetActor, sheetId: string, input: { name?: string; description?: string; settings?: unknown }) {
  const before = await getSheet(actor.organizationId, sheetId);
  const data: Prisma.SheetUpdateManyMutationInput = { updatedById: actor.userId };
  if (input.settings !== undefined) {
    const parsed = sheetSettingsSchema.safeParse(input.settings);
    if (!parsed.success) throw new SheetError(400, parsed.error.issues[0]?.message ?? "Configuração inválida");
    data.settings = parsed.data as Prisma.InputJsonValue;
  }
  if (input.name !== undefined) data.name = checkName(input.name, "planilha");
  if (input.description !== undefined) data.description = input.description.trim().slice(0, SHEET_LIMITS.descriptionChars);
  const res = await runWithTenant(actor.organizationId, () =>
    prisma.sheet.updateMany({ where: { id: sheetId, organizationId: actor.organizationId, archivedAt: null }, data }),
  );
  if (res.count === 0) throw sheetNotFound();
  const after = await getSheet(actor.organizationId, sheetId);
  const beforeState = { name: before.name, description: before.description, settings: before.settings };
  const afterState = { name: after.name, description: after.description, settings: after.settings };
  if (JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
    await runWithTenant(actor.organizationId, () =>
      prisma.sheetActivity.create({
        data: {
          organizationId: actor.organizationId,
          sheetId,
          userId: actor.userId,
          source: actor.source,
          action: "SHEET_UPDATED",
          changes: { before: beforeState, after: afterState },
        },
      }),
    );
  }
}

/** Arquivar esconde (reversível). Não existe "apagar de vez" pela tela de propósito. */
export async function setSheetArchived(actor: SheetActor, sheetId: string, archived: boolean) {
  return prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, actor.organizationId);
    const res = await tx.sheet.updateMany({
      where: { id: sheetId, organizationId: actor.organizationId, archivedAt: archived ? null : { not: null } },
      data: { archivedAt: archived ? new Date() : null, updatedById: actor.userId },
    });
    if (res.count === 0) throw sheetNotFound();
    if (!archived) {
      const total = await tx.sheet.count({ where: { organizationId: actor.organizationId, archivedAt: null } });
      if (total > SHEET_LIMITS.sheetsPerOrg) throw new SheetError(400, `Limite de ${SHEET_LIMITS.sheetsPerOrg} planilhas ativas atingido`);
    }
    await tx.sheetActivity.create({
      data: { organizationId: actor.organizationId, sheetId, userId: actor.userId, source: actor.source, action: archived ? "SHEET_ARCHIVED" : "SHEET_RESTORED" },
    });
  });
}

async function assertSheetActive(tx: Prisma.TransactionClient, organizationId: string, sheetId: string) {
  const sheet = await tx.sheet.findFirst({ where: { id: sheetId, organizationId, archivedAt: null }, select: { id: true } });
  if (!sheet) throw sheetNotFound();
}

export async function createColumn(actor: SheetActor, sheetId: string, input: ColumnInput & { position?: number }) {
  const data = columnData(input);
  return prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, actor.organizationId);
    await assertSheetActive(tx, actor.organizationId, sheetId);
    const active = await tx.sheetColumn.findMany({
      where: { sheetId, organizationId: actor.organizationId, archivedAt: null },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    if (active.length >= SHEET_LIMITS.columnsPerSheet) throw new SheetError(400, `Máximo de ${SHEET_LIMITS.columnsPerSheet} colunas`);
    // Coluna obrigatória nova numa planilha com linhas deixaria todas inválidas.
    if (data.required) {
      const rows = await tx.sheetRow.count({ where: { sheetId, organizationId: actor.organizationId, deletedAt: null } });
      if (rows > 0) throw new SheetError(400, "Crie a coluna como opcional, preencha os valores e só depois marque como obrigatória");
    }
    const at = Math.max(0, Math.min(input.position ?? active.length, active.length));
    const col = await tx.sheetColumn.create({
      data: { ...data, organizationId: actor.organizationId, sheetId, position: at },
      select: columnSelect,
    });
    await reindexColumns(tx, [...active.slice(0, at).map((c) => c.id), col.id, ...active.slice(at).map((c) => c.id)]);
    await touchSheet(tx, actor, sheetId, "COLUMN_CREATED", {
      columnId: col.id,
      name: col.name,
      type: col.type,
      config: col.config,
      required: col.required,
      position: at,
    });
    return { ...col, position: at };
  });
}

async function reindexColumns(tx: Prisma.TransactionClient, orderedIds: string[]) {
  await Promise.all(orderedIds.map((id, position) => tx.sheetColumn.update({ where: { id }, data: { position } })));
}

async function touchSheet(tx: Prisma.TransactionClient, actor: SheetActor, sheetId: string, action: string, changes?: Prisma.InputJsonValue) {
  await tx.sheet.update({ where: { id: sheetId }, data: { updatedById: actor.userId } });
  await tx.sheetActivity.create({
    data: { organizationId: actor.organizationId, sheetId, userId: actor.userId, source: actor.source, action, changes },
  });
}

/**
 * Renomear/configurar/reordenar/trocar tipo. Troca de tipo reconverte os
 * valores existentes: se algum não couber no tipo novo, recusa e informa
 * quantos — com `force`, apaga só esses valores (decisão explícita do usuário).
 */
export async function updateColumn(
  actor: SheetActor,
  sheetId: string,
  columnId: string,
  input: Partial<ColumnInput> & { position?: number; force?: boolean; onInvalid?: "clear" | "zero" | "addOptions" },
) {
  return prismaRaw.$transaction(
    async (tx) => {
      await setTenantOnTx(tx, actor.organizationId);
      await assertSheetActive(tx, actor.organizationId, sheetId);
      const current = await tx.sheetColumn.findFirst({
        where: { id: columnId, sheetId, organizationId: actor.organizationId, archivedAt: null },
        select: columnSelect,
      });
      if (!current) throw new SheetError(404, "Coluna não encontrada");

      const next = {
        name: input.name !== undefined ? checkColumnName(input.name) : current.name,
        type: input.type ?? current.type,
        required: input.required ?? current.required,
        config: current.config as unknown,
      };
      if (input.config !== undefined || input.type !== undefined) {
        const cfg = normalizeColumnConfig(next.type, input.config ?? current.config);
        if (!cfg.ok) throw new SheetError(400, cfg.error);
        next.config = cfg.config;
      }

      const valuesMayBreak = next.type !== current.type || next.type === "SELECT" || next.type === "MULTI_SELECT";
      if (valuesMayBreak || (next.required && !current.required)) {
        const rows = await tx.sheetRow.findMany({
          where: { sheetId, organizationId: actor.organizationId, deletedAt: null },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          select: { id: true, values: true, formulas: true },
        });
        // Se mudou para Lista de opções (SELECT/MULTI_SELECT) sem opções definidas (ou pediu "addOptions"),
        // coleta automaticamente os valores existentes da coluna como opções para não perder dados.
        if (next.type === "SELECT" || next.type === "MULTI_SELECT") {
          const curOpts = [...(((next.config as { options?: string[] } | null)?.options) ?? [])];
          const changingToList = current.type !== "SELECT" && current.type !== "MULTI_SELECT" && curOpts.length === 0;
          if (changingToList || input.onInvalid === "addOptions") {
            const seen = new Set(curOpts);
            for (const r of rows) {
              const raw = (r.values as Record<string, unknown>)[columnId];
              if (raw === undefined || raw === null) continue;
              const parts = Array.isArray(raw)
                ? raw.map(String)
                : next.type === "MULTI_SELECT" && typeof raw === "string"
                  ? raw.split(/[;,]/)
                  : [String(raw)];
              for (const part of parts) {
                const clean = part.trim().slice(0, SHEET_LIMITS.optionChars);
                if (clean && !seen.has(clean) && seen.size < SHEET_LIMITS.optionsPerColumn) {
                  seen.add(clean);
                  curOpts.push(clean);
                }
              }
            }
            next.config = { ...(next.config as object), options: curOpts };
          }
        }
        // Tipo novo que não aceita fórmula (Seleção, Cliente…): célula com fórmula conta como
        // valor que não cabe — sai junto com `force`, senão o recálculo da tela a reescreveria.
        const formulaRows = new Set(
          NO_FORMULA_TYPES.has(next.type)
            ? rows.filter((r) => (r.formulas as Record<string, string> | null)?.[columnId]).map((r) => r.id)
            : [],
        );
        const probe = { id: columnId, name: next.name, type: next.type, config: next.config, required: next.required };
        const invalid: string[] = [];
        const invalidSamples: { rowNumber: number; value: string }[] = [];
        const converted: { id: string; value: unknown }[] = [];
        let empty = 0;
        for (let idx = 0; idx < rows.length; idx++) {
          const r = rows[idx];
          const rowNumber = idx + 2;
          if (formulaRows.has(r.id)) {
            invalid.push(r.id);
            if (invalidSamples.length < 8) invalidSamples.push({ rowNumber, value: "Fórmula" });
            continue;
          }
          const raw = (r.values as Record<string, unknown>)[columnId];
          if (raw === undefined) {
            empty++;
            continue;
          }
          try {
            // Ao converter, o valor antigo vira texto primeiro (ex.: número → texto "12.5").
            const v = coerceCellValue(probe, Array.isArray(raw) && next.type !== "MULTI_SELECT" ? raw.join(", ") : raw);
            if (v !== raw) converted.push({ id: r.id, value: v });
          } catch (err) {
            if (!(err instanceof CellValueError)) throw err;
            invalid.push(r.id);
            if (invalidSamples.length < 8) {
              const display = Array.isArray(raw) ? raw.join(", ") : String(raw);
              invalidSamples.push({ rowNumber, value: display.slice(0, 60) });
            }
          }
        }
        const canZero = input.onInvalid === "zero" && (next.type === "NUMBER" || next.type === "CURRENCY" || next.type === "PERCENT");
        const canClear = Boolean(input.force || input.onInvalid === "clear");
        if (invalid.length && !canClear && !canZero) {
          throw new SheetError(409, `${invalid.length} valor(es) não cabem na nova configuração da coluna`, {
            invalidCount: invalid.length,
            sampleRowIds: invalid.slice(0, 20),
            invalidSamples,
            emptyCount: empty,
          });
        }
        if (canZero) {
          for (const id of invalid) converted.push({ id, value: 0 });
          invalid.length = 0;
        }
        if (next.required && (empty > 0 || invalid.length > 0)) {
          if (canClear) {
            next.required = false;
          } else {
            throw new SheetError(400, `Há ${empty + invalid.length} linha(s) sem valor nesta coluna — preencha antes de torná-la obrigatória`);
          }
        }
        await setCellsRaw(tx, columnId, [...invalid.map((id) => ({ id, value: undefined })), ...converted]);
        if (formulaRows.size) {
          await tx.$executeRaw`UPDATE "SheetRow" SET "formulas" = "formulas" - ${columnId}, "updatedAt" = now()
            WHERE "sheetId" = ${sheetId} AND "formulas" ? ${columnId}`;
        }
      }

      await tx.sheetColumn.update({
        where: { id: columnId },
        data: { name: next.name, type: next.type, required: next.required, config: next.config as Prisma.InputJsonValue },
      });

      if (next.type !== current.type && (REFERENCE_TYPES.has(next.type) || REFERENCE_TYPES.has(current.type))) {
        await tx.sheetRowLink.deleteMany({ where: { columnId, organizationId: actor.organizationId } });
        // Vínculos voltam só para CONTACT/DEAL; referências inválidas foram limpas acima (USER não indexa).
        if (next.type === "CONTACT" || next.type === "DEAL") await rebuildColumnLinks(tx, actor.organizationId, sheetId, columnId, next.type);
      }

      if (input.position !== undefined && input.position !== current.position) {
        const active = await tx.sheetColumn.findMany({
          where: { sheetId, organizationId: actor.organizationId, archivedAt: null, id: { not: columnId } },
          orderBy: { position: "asc" },
          select: { id: true },
        });
        const at = Math.max(0, Math.min(input.position, active.length));
        await reindexColumns(tx, [...active.slice(0, at).map((c) => c.id), columnId, ...active.slice(at).map((c) => c.id)]);
      }

      await touchSheet(tx, actor, sheetId, "COLUMN_UPDATED", {
        columnId,
        before: { name: current.name, type: current.type, config: current.config, required: current.required, position: current.position },
        after: {
          name: next.name,
          type: next.type,
          config: next.config as Prisma.InputJsonValue,
          required: next.required,
          position: input.position ?? current.position,
        },
      });
      return tx.sheetColumn.findUniqueOrThrow({ where: { id: columnId }, select: columnSelect });
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

/**
 * Grava (ou apaga, `undefined`) o valor de UMA coluna em muitas linhas com um
 * UPDATE por lote de 1.000 — antes era um UPDATE por linha, e trocar o tipo de
 * uma coluna numa planilha grande estourava o tempo da transação.
 */
async function setCellsRaw(tx: Prisma.TransactionClient, columnId: string, items: { id: string; value: unknown }[]) {
  for (let i = 0; i < items.length; i += 1000) {
    const chunk = items.slice(i, i + 1000);
    const rowsSql = Prisma.join(chunk.map((c) => Prisma.sql`(${c.id}, ${c.value === undefined ? null : JSON.stringify(c.value)}::jsonb)`));
    await tx.$executeRaw`
      UPDATE "SheetRow" AS r
      SET "values" = CASE WHEN v.val IS NULL THEN r."values" - ${columnId} ELSE jsonb_set(r."values", ARRAY[${columnId}]::text[], v.val, true) END,
          "updatedAt" = now()
      FROM (VALUES ${rowsSql}) AS v(id, val)
      WHERE r.id = v.id`;
  }
}

async function rebuildColumnLinks(tx: Prisma.TransactionClient, organizationId: string, sheetId: string, columnId: string, type: "CONTACT" | "DEAL") {
  const rows = await tx.$queryRaw<{ id: string; ref: string }[]>`
    SELECT id, "values" ->> ${columnId} AS ref FROM "SheetRow"
    WHERE "sheetId" = ${sheetId} AND "deletedAt" IS NULL AND "values" ? ${columnId}`;
  if (!rows.length) return;
  const refs = [...new Set(rows.map((r) => r.ref))];
  const existing = new Set(
    type === "CONTACT"
      ? (await tx.contact.findMany({ where: { organizationId, id: { in: refs } }, select: { id: true } })).map((c) => c.id)
      : (await tx.deal.findMany({ where: { organizationId, id: { in: refs } }, select: { id: true } })).map((d) => d.id),
  );
  const valid = rows.filter((r) => existing.has(r.ref));
  await setCellsRaw(tx, columnId, rows.filter((r) => !existing.has(r.ref)).map((r) => ({ id: r.id, value: undefined })));
  await tx.sheetRowLink.createMany({
    data: valid.map((r) => ({
      organizationId,
      rowId: r.id,
      columnId,
      contactId: type === "CONTACT" ? r.ref : null,
      dealId: type === "DEAL" ? r.ref : null,
    })),
  });
}

/** Colunas arquivadas (para restaurar pela tela). */
export async function listArchivedColumns(organizationId: string, sheetId: string) {
  return runWithTenant(organizationId, () =>
    prisma.sheetColumn.findMany({
      where: { sheetId, organizationId, archivedAt: { not: null }, sheet: { archivedAt: null } },
      orderBy: { archivedAt: "desc" },
      select: { ...columnSelect, archivedAt: true },
    }),
  );
}

/**
 * Limpa o conteúdo de colunas INTEIRAS (Delete com a coluna selecionada pela letra,
 * como no Excel): valores, fórmulas e marcações saem de todas as linhas, inclusive as
 * que a tela ainda não carregou; a coluna continua existindo. Um UPDATE só.
 */
export async function clearColumns(actor: SheetActor, sheetId: string, columnIds: string[]) {
  const ids = [...new Set(columnIds)].slice(0, SHEET_LIMITS.columnsPerSheet);
  if (!ids.length) return 0;
  return prismaRaw.$transaction(
    async (tx) => {
      await setTenantOnTx(tx, actor.organizationId);
      await assertSheetActive(tx, actor.organizationId, sheetId);
      const valid = await tx.sheetColumn.findMany({ where: { sheetId, organizationId: actor.organizationId, id: { in: ids }, archivedAt: null }, select: { id: true } });
      if (valid.length !== ids.length) throw new SheetError(400, "Coluna inexistente ou arquivada");
      const changed = await tx.$executeRaw`
        UPDATE "SheetRow"
        SET "values" = "values" - ${ids}::text[], "formulas" = "formulas" - ${ids}::text[], "formats" = "formats" - ${ids}::text[], "updatedAt" = now()
        WHERE "sheetId" = ${sheetId} AND "deletedAt" IS NULL
          AND ("values" ?| ${ids}::text[] OR "formulas" ?| ${ids}::text[] OR "formats" ?| ${ids}::text[])`;
      await tx.sheetRowLink.deleteMany({ where: { columnId: { in: ids }, organizationId: actor.organizationId } });
      await touchSheet(tx, actor, sheetId, "COLUMN_CLEARED", { columnIds: ids, rows: changed });
      return changed;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

/** Só id+nome, para payload de webhook/auditoria. */
export async function sheetRef(organizationId: string, sheetId: string) {
  const s = await runWithTenant(organizationId, () =>
    prisma.sheet.findFirst({ where: { id: sheetId, organizationId }, select: { id: true, name: true } }),
  );
  if (!s) throw sheetNotFound();
  return s;
}

/** Arquivar coluna esconde e para de validar; os valores ficam guardados (restaurar traz de volta). */
export async function setColumnArchived(actor: SheetActor, sheetId: string, columnId: string, archived: boolean) {
  return prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, actor.organizationId);
    await assertSheetActive(tx, actor.organizationId, sheetId);
    const col = await tx.sheetColumn.findFirst({
      where: { id: columnId, sheetId, organizationId: actor.organizationId, archivedAt: archived ? null : { not: null } },
      select: { id: true, name: true, type: true },
    });
    if (!col) throw new SheetError(404, "Coluna não encontrada");
    const active = await tx.sheetColumn.findMany({
      where: { sheetId, organizationId: actor.organizationId, archivedAt: null, id: { not: columnId } },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    if (!archived && active.length >= SHEET_LIMITS.columnsPerSheet) throw new SheetError(400, `Máximo de ${SHEET_LIMITS.columnsPerSheet} colunas`);
    await tx.sheetColumn.update({ where: { id: columnId }, data: { archivedAt: archived ? new Date() : null, required: archived ? false : undefined } });
    await reindexColumns(tx, archived ? active.map((c) => c.id) : [...active.map((c) => c.id), columnId]);
    // Vínculo de coluna arquivada não deve aparecer na ficha do cliente.
    if (archived) await tx.sheetRowLink.deleteMany({ where: { columnId, organizationId: actor.organizationId } });
    else if (col.type === "CONTACT" || col.type === "DEAL") await rebuildColumnLinks(tx, actor.organizationId, sheetId, columnId, col.type);
    await touchSheet(tx, actor, sheetId, archived ? "COLUMN_ARCHIVED" : "COLUMN_RESTORED", { columnId, name: col.name });
  });
}
