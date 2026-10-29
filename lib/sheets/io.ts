/**
 * Entrada e saída de planilhas: importar .xlsx/.csv (em planilha nova, com
 * tipos detectados, ou numa existente, casando cabeçalho com coluna) e
 * exportar para .xlsx. A leitura do arquivo passa SEMPRE por
 * parseSpreadsheet (worker isolado — ver lib/parse-spreadsheet.ts sobre as
 * CVEs do ExcelJS); escrever .xlsx não tem esse risco.
 */

import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { normalizeHeader, parseSpreadsheet } from "@/lib/parse-spreadsheet";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { formatCpf, isValidCpf, normalizeCpf } from "@/lib/cpf";
import { formatCnpj, isValidCnpj, normalizeCnpj } from "@/lib/cnpj";
import { displayPhone, normalizePhoneNumber } from "@/lib/phone-normalize";
import { SHEET_LIMITS } from "@/lib/sheets/limits";
import { SheetError } from "@/lib/sheets/errors";
import { createSheet, getSheet, type SheetActor, type SheetColumnRow } from "@/lib/sheets/sheets";
import { insertRows, queryRows } from "@/lib/sheets/rows";
import { isCheckboxLikeColumn, isMonthYearDate, isMultiUserColumn, parseLooseDate, parseLooseNumber, refIds, splitMemberNames, type CellValue, type SheetColumnType } from "@/lib/sheets/column-types";
import { readSheetSettings, resolveTableRange, TABLE_STYLE_BY_ID, type CellBorder, type RowFormats, type TotalFn } from "@/lib/sheets/formats";
import { displayFormula, indexToLetter } from "@/lib/sheets/formula";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Detecta o tipo de uma coluna importada olhando os valores preenchidos:
 * só "promove" de Texto quando TODOS batem — melhor um Texto que a pessoa
 * troca depois do que perder linha na importação por tipo errado.
 */
export function inferColumnType(header: string, values: string[]): { type: SheetColumnType; options?: string[]; config?: Record<string, unknown> } {
  const filled = values.map((v) => v.trim()).filter(Boolean);
  if (!filled.length) return { type: "TEXT" };
  const all = (fn: (v: string) => boolean) => filled.every(fn);
  const h = normalizeHeader(header);

  if (all((v) => EMAIL_RE.test(v))) return { type: "EMAIL" };
  if (all((v) => isValidCpf(normalizeCpf(v)))) return { type: "CPF" };
  if (all((v) => isValidCnpj(normalizeCnpj(v)))) return { type: "CNPJ" };
  if (isCheckboxLikeColumn(filled)) return { type: "CHECKBOX" };
  if (all((v) => parseLooseDate(v) !== null)) {
    return { type: "DATE", ...(filled.every(isMonthYearDate) ? { config: { dateFormat: "monthYear" } } : {}) };
  }
  if (/(telefone|celular|whats|fone)/.test(h) && all((v) => normalizePhoneNumber(v) !== null)) return { type: "PHONE" };
  if (all((v) => /^R\$/.test(v.trim())) || (/(valor|preco|credito|parcela|salario)/.test(h) && all((v) => parseLooseNumber(v) !== null))) return { type: "CURRENCY" };
  if (all((v) => /%$/.test(v.trim()) && parseLooseNumber(v) !== null)) return { type: "PERCENT" };
  if (all((v) => parseLooseNumber(v) !== null)) return { type: "NUMBER" };
  if (all((v) => /^(sim|não|nao|s|n|x|true|false|ok)$/i.test(v.trim()))) return { type: "CHECKBOX" };
  if (all((v) => /^https?:\/\//i.test(v))) return { type: "URL" };

  // Poucos valores distintos e repetidos = lista de opções (status, etapa…).
  const distinct = [...new Set(filled)];
  if (filled.length >= 10 && distinct.length <= 12 && distinct.length <= filled.length / 3 && distinct.every((d) => d.length <= SHEET_LIMITS.optionChars)) {
    return { type: "SELECT", options: distinct };
  }
  return { type: filled.some((v) => v.length > SHEET_LIMITS.textChars) ? "LONG_TEXT" : "TEXT" };
}

async function readSheetFile(buffer: Buffer, filename: string) {
  const rows = await parseSpreadsheet(buffer, filename, {
    maxRows: SHEET_LIMITS.importRows + 1,
    maxColumns: SHEET_LIMITS.importColumns,
    maxCellCharacters: SHEET_LIMITS.longTextChars,
  });
  const [header, ...body] = rows;
  if (!header?.some((h) => h.trim())) throw new SheetError(400, "A primeira linha da planilha precisa ter os nomes das colunas");
  const data = body.filter((r) => r.some((c) => c?.trim()));
  if (!data.length) throw new SheetError(400, "A planilha não tem linhas com dados");
  // Como no Excel: coluna sem título fica sem título (nada de "Coluna 6"), e coluna
  // totalmente vazia (sem título e sem dado) nem é criada.
  const keep = header.map((h, i) => !!h.trim() || data.some((r) => r[i]?.trim())).flatMap((k, i) => (k ? [i] : []));
  return { header: keep.map((i) => header[i].trim()), data: data.map((r) => keep.map((i) => r[i] ?? "")) };
}

/**
 * Casa o texto de uma célula CONTACT com um cliente: id, telefone/WhatsApp
 * ou e-mail. Só aceita quando acha EXATAMENTE um — ambíguo vira "não achou"
 * (vincular o cliente errado é pior que não vincular).
 */
async function contactMatcher(organizationId: string, raws: string[]) {
  const phones = new Set<string>();
  const emails = new Set<string>();
  for (const r of raws) {
    const t = r.trim();
    if (EMAIL_RE.test(t)) emails.add(t.toLowerCase());
    else {
      const p = normalizePhoneNumber(t);
      if (p) phones.add(p);
    }
  }
  const found = await runWithTenant(organizationId, () =>
    prisma.contact.findMany({
      where: {
        organizationId,
        OR: [
          { id: { in: raws.map((r) => r.trim()) } },
          ...(phones.size ? [{ phoneNormalized: { in: [...phones] } }, { whatsappNormalized: { in: [...phones] } }] : []),
          ...(emails.size ? [{ email: { in: [...emails], mode: "insensitive" as const } }] : []),
        ],
      },
      select: { id: true, phoneNormalized: true, whatsappNormalized: true, email: true },
      take: 50_000,
    }),
  );
  const index = new Map<string, Set<string>>();
  const add = (k: string | null | undefined, id: string) => {
    if (!k) return;
    const s = index.get(k) ?? new Set<string>();
    s.add(id);
    index.set(k, s);
  };
  for (const c of found) {
    add(c.id, c.id);
    add(c.phoneNormalized, c.id);
    add(c.whatsappNormalized, c.id);
    add(c.email?.toLowerCase(), c.id);
  }
  return (raw: string): string | null => {
    const t = raw.trim();
    const key = EMAIL_RE.test(t) ? t.toLowerCase() : index.has(t) ? t : normalizePhoneNumber(t);
    const ids = key ? index.get(key) : undefined;
    return ids && ids.size === 1 ? [...ids][0] : null;
  };
}

async function userMatcher(organizationId: string) {
  const members = await runWithTenant(organizationId, () =>
    prisma.organizationUser.findMany({ where: { organizationId }, select: { userId: true, user: { select: { name: true, email: true } } } }),
  );
  const index = new Map<string, string>();
  for (const m of members) {
    index.set(m.userId, m.userId);
    if (m.user.email) index.set(m.user.email.toLowerCase(), m.userId);
    if (m.user.name) index.set(normalizeHeader(m.user.name), m.userId);
  }
  return (raw: string) => index.get(raw.trim()) ?? index.get(raw.trim().toLowerCase()) ?? index.get(normalizeHeader(raw)) ?? null;
}

export type ImportResult = { sheetId: string; created: number; skipped: { line: number; error: string }[]; unmatched: number };

/**
 * Importa linhas. Valor que não passa na validação NÃO derruba a
 * importação: a linha vai inteira para `skipped` com o motivo (a pessoa
 * corrige e importa só essas). Grava em lotes de SHEET_LIMITS.batchRows.
 */
async function importInto(actor: SheetActor, sheetId: string, columns: SheetColumnRow[], mapping: (number | null)[], data: string[][]): Promise<ImportResult> {
  const contactCols = columns.filter((c, i) => c.type === "CONTACT" && mapping[i] !== null);
  const userCols = columns.filter((c, i) => c.type === "USER" && mapping[i] !== null);
  const matchContact = contactCols.length
    ? await contactMatcher(actor.organizationId, data.flatMap((r) => contactCols.map((c) => r[mapping[columns.indexOf(c)]!] ?? "")).filter(Boolean))
    : null;
  const matchUser = userCols.length ? await userMatcher(actor.organizationId) : null;

  let unmatched = 0;
  const prepared = data.map((r) => {
    const values: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      const src = mapping[i];
      if (src === null) return;
      let v: string | undefined = r[src]?.trim();
      if (!v) return;
      if (col.type === "CONTACT" && matchContact) {
        const idFound = matchContact(v);
        if (!idFound) unmatched++;
        v = idFound ?? undefined;
      } else if (col.type === "USER" && matchUser) {
        if (isMultiUserColumn(col)) {
          // "EDU/FELIPE" numa coluna com vários membros: cada nome vira um membro.
          const found = splitMemberNames(v).map((n) => matchUser(n));
          if (found.some((x) => !x)) unmatched++;
          const ids = [...new Set(found.filter((x): x is string => !!x))];
          if (ids.length) values[col.id] = ids;
          return;
        }
        const idFound = matchUser(v);
        if (!idFound) unmatched++;
        v = idFound ?? undefined;
      }
      if (v !== undefined) values[col.id] = v;
    });
    return values;
  });

  const skipped: ImportResult["skipped"] = [];
  let created = 0;
  for (let start = 0; start < prepared.length; start += SHEET_LIMITS.batchRows) {
    let batch = prepared.slice(start, start + SHEET_LIMITS.batchRows).map((values, i) => ({ values, line: start + i + 2 }));
    // Tenta o lote inteiro; se uma linha falhar, separa ela e tenta de novo
    // (no máximo uma vez por linha inválida — nunca loop infinito).
    for (;;) {
      try {
        const rows = await insertRows(actor, sheetId, batch.map((b) => b.values));
        created += rows.length;
        break;
      } catch (err) {
        const idx = err instanceof SheetError && typeof err.details?.rowIndex === "number" ? err.details.rowIndex : -1;
        if (!(err instanceof SheetError) || idx < 0 || !batch[idx]) throw err;
        skipped.push({ line: batch[idx].line, error: err.message.replace(/^Linha \d+: /, "") });
        batch = batch.filter((_, i) => i !== idx);
        if (!batch.length) break;
      }
    }
  }
  return { sheetId, created, skipped, unmatched };
}

/** Importa criando uma planilha nova com as colunas e tipos detectados. */
export async function importAsNewSheet(actor: SheetActor, file: { buffer: Buffer; filename: string; name?: string }): Promise<ImportResult> {
  const { header, data } = await readSheetFile(file.buffer, file.filename);
  const columnsInput = header.map((name, i) => {
    const inferred = inferColumnType(name, data.map((r) => r[i] ?? ""));
    return {
      name: name.slice(0, SHEET_LIMITS.nameChars),
      type: inferred.type,
      config: inferred.config ?? (inferred.options ? { options: inferred.options } : undefined),
    };
  });
  const baseName = (file.name?.trim() || file.filename.replace(/\.(xlsx|csv)$/i, "")).slice(0, SHEET_LIMITS.nameChars);
  const { id } = await createSheet(actor, { name: baseName || "Planilha importada", columns: columnsInput });
  const sheet = await getSheet(actor.organizationId, id);
  return importInto(actor, id, sheet.columns, sheet.columns.map((_, i) => i), data);
}

/**
 * Importa numa planilha existente. `mapping` opcional: { <columnId>:
 * índice da coluna no arquivo }; sem ele, casa pelo nome do cabeçalho
 * (sem acento/maiúscula). Coluna do arquivo sem par é ignorada.
 */
export async function importIntoSheet(
  actor: SheetActor,
  sheetId: string,
  file: { buffer: Buffer; filename: string },
  mapping?: Record<string, number>,
): Promise<ImportResult> {
  const sheet = await getSheet(actor.organizationId, sheetId);
  const { header, data } = await readSheetFile(file.buffer, file.filename);
  const normalized = header.map(normalizeHeader);
  const map = sheet.columns.map((c) => {
    if (mapping && c.id in mapping) {
      const idx = mapping[c.id];
      return Number.isInteger(idx) && idx >= 0 && idx < header.length ? idx : null;
    }
    if (mapping) return null;
    const idx = normalized.indexOf(normalizeHeader(c.name));
    return idx >= 0 ? idx : null;
  });
  if (map.every((m) => m === null)) throw new SheetError(400, "Nenhuma coluna do arquivo corresponde às colunas da planilha");
  return importInto(actor, sheetId, sheet.columns, map, data);
}

/** Prévia: cabeçalho, 20 primeiras linhas e tipos sugeridos — nada é gravado. */
export async function previewImport(file: { buffer: Buffer; filename: string }) {
  const { header, data } = await readSheetFile(file.buffer, file.filename);
  return {
    header,
    totalRows: data.length,
    sample: data.slice(0, 20),
    suggested: header.map((h, i) => inferColumnType(h, data.map((r) => r[i] ?? ""))),
  };
}

// ─── Exportação ──────────────────────────────────────────────────────

export async function referenceNames(organizationId: string, columns: SheetColumnRow[], rows: { values: Record<string, CellValue> }[]) {
  const ids = { USER: new Set<string>(), CONTACT: new Set<string>(), DEAL: new Set<string>() };
  for (const c of columns) {
    if (c.type !== "USER" && c.type !== "CONTACT" && c.type !== "DEAL") continue;
    for (const r of rows) for (const v of refIds(r.values[c.id])) ids[c.type].add(v);
  }
  const names = new Map<string, string>();
  await runWithTenant(organizationId, async () => {
    if (ids.USER.size) for (const u of await prisma.user.findMany({ where: { id: { in: [...ids.USER] } }, select: { id: true, name: true } })) names.set(u.id, u.name ?? "");
    if (ids.CONTACT.size) for (const c of await prisma.contact.findMany({ where: { organizationId, id: { in: [...ids.CONTACT] } }, select: { id: true, name: true } })) names.set(c.id, c.name);
    if (ids.DEAL.size) for (const d of await prisma.deal.findMany({ where: { organizationId, id: { in: [...ids.DEAL] } }, select: { id: true, name: true } })) names.set(d.id, d.name);
  });
  return names;
}

function exportCell(col: SheetColumnRow, v: CellValue | undefined, names: Map<string, string>): string | number | boolean | Date | null {
  if (v === undefined) return null;
  switch (col.type) {
    case "NUMBER":
    case "CURRENCY":
      return v as number;
    case "PERCENT":
      return (v as number) / 100;
    case "DATE": {
      const [y, m, d] = String(v).split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d));
    }
    case "CHECKBOX":
      return v ? "Sim" : "Não";
    case "MULTI_SELECT":
      return sanitizeCell((v as string[]).join(", "));
    case "CPF":
      return formatCpf(String(v));
    case "CNPJ":
      return formatCnpj(String(v));
    case "PHONE":
      return displayPhone(String(v)) ?? String(v);
    case "USER":
    case "CONTACT":
    case "DEAL":
      return sanitizeCell(refIds(v).map((id) => names.get(id) ?? "").join(", "));
    default:
      // Texto livre é onde mora a fórmula maliciosa (=HYPERLINK…) — neutraliza.
      return sanitizeCell(String(v));
  }
}

const XLSX_TOTAL_FN: Record<TotalFn, "none" | "sum" | "average" | "count" | "countNums" | "min" | "max"> = {
  none: "none",
  sum: "sum",
  avg: "average",
  count: "count",
  countFilled: "countNums",
  min: "min",
  max: "max",
};

/** "#RRGGBB" → ARGB do ExcelJS ("FFRRGGBB"). */
const argb = (hex: string) => `FF${hex.slice(1).toUpperCase()}`;
const xlsxBorder = (line: CellBorder | undefined): Partial<ExcelJS.Border> | undefined => {
  if (!line) return undefined;
  return line.color ? { style: line.style, color: { argb: argb(line.color) } } : { style: line.style };
};

/**
 * Gera o .xlsx de uma planilha inteira (ou só das linhas filtradas). Sai como
 * o Excel faria: com "Formatar como Tabela" vira uma TABELA de verdade
 * (mesmo preset de estilo, botões de filtro, linha de totais com fórmula
 * SUBTOTAL); sem tabela, cabeçalho em negrito com AutoFiltro. Marcações de
 * célula (negrito, cores, alinhamento…) vão junto. Linha 1 congelada.
 */
export async function exportSheetXlsx(organizationId: string, sheetId: string, query: Parameters<typeof queryRows>[2] = {}) {
  const sheet = await getSheet(organizationId, sheetId);
  const settings = readSheetSettings(sheet.settings);
  const rows: { values: Record<string, CellValue>; formats?: RowFormats; formulas?: Record<string, string> }[] = [];
  for (let offset = 0; offset < SHEET_LIMITS.exportRows; offset += SHEET_LIMITS.pageSizeMax) {
    const page = await queryRows(organizationId, sheetId, { ...query, offset, limit: SHEET_LIMITS.pageSizeMax });
    rows.push(...page.rows);
    if (page.rows.length < SHEET_LIMITS.pageSizeMax) break;
  }
  const names = await referenceNames(organizationId, sheet.columns, rows);
  const cols = sheet.columns;

  const wb = new ExcelJS.Workbook();
  // Caracteres que o Excel não aceita em nome de aba: \ / * ? : [ ]
  const ws = wb.addWorksheet(sheet.name.replace(/[\\/*?:[\]]/g, " ").slice(0, 31) || "Planilha", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const data = rows.map((r) => cols.map((c) => exportCell(c, r.values[c.id], names)));
  const table = settings.table;

  const tableAt = table ? resolveTableRange(table.range, cols.map((c) => c.id)) : null;
  // O .xlsx exige cabeçalho de tabela com nomes únicos e não vazios: coluna sem título
  // vira "Coluna1", "Coluna2"… só no arquivo (é o que o Excel faz ao criar a tabela).
  const tableHeaders = (names: string[]) => {
    const used = new Set<string>();
    return names.map((n, i) => {
      let name = n.trim() || `Coluna${i + 1}`;
      let k = 2;
      while (used.has(name.toLowerCase())) name = `${n.trim() || `Coluna${i + 1}`}${k++}`;
      used.add(name.toLowerCase());
      return name;
    });
  };
  const styleOf = (t: NonNullable<typeof table>) => ({
    theme: TABLE_STYLE_BY_ID.get(t.style)!.excelName as ExcelJS.TableStyleProperties["theme"],
    showRowStripes: t.banded,
    showFirstColumn: t.firstColumn,
  });

  if (table && tableAt && !table.range) {
    const headers = tableHeaders(cols.map((c) => c.name));
    ws.addTable({
      name: "Tabela1",
      ref: "A1",
      headerRow: true,
      totalsRow: table.totals,
      style: styleOf(table),
      columns: cols.map((c, i) => ({ name: headers[i], filterButton: true, totalsRowFunction: table.totals ? XLSX_TOTAL_FN[table.totalsFns[c.id] ?? "none"] : undefined })),
      // Tabela do Excel não pode ficar sem linha de dados: uma vazia segura o formato.
      rows: data.length ? data : [cols.map(() => null)],
    });
  } else {
    ws.addRow(cols.map((c) => c.name)).font = { bold: true };
    for (const line of data) ws.addRow(line);
    if (table && tableAt) {
      // Tabela só no intervalo escolhido (linha do Excel = posição real, a exportação sai na ordem real).
      const lastRow = Math.min(tableAt.r2, data.length + 1);
      if (tableAt.r1 < lastRow || (tableAt.r1 === 1 && lastRow >= 1)) {
        const colSlice = cols.slice(tableAt.c1, tableAt.c2 + 1);
        const headerTexts = tableAt.r1 === 1 ? colSlice.map((c) => c.name) : colSlice.map((_, j) => String(data[tableAt.r1 - 2]?.[tableAt.c1 + j] ?? ""));
        const headers = tableHeaders(headerTexts);
        const body = data.slice(tableAt.r1 - 1, lastRow - 1).map((line) => line.slice(tableAt.c1, tableAt.c2 + 1));
        const withTotals = table.totals && table.range?.r2 === null;
        ws.addTable({
          name: "Tabela1",
          ref: `${indexToLetter(tableAt.c1)}${tableAt.r1}`,
          headerRow: true,
          totalsRow: withTotals,
          style: styleOf(table),
          columns: colSlice.map((c, j) => ({ name: headers[j], filterButton: true, totalsRowFunction: withTotals ? XLSX_TOTAL_FN[table.totalsFns[c.id] ?? "none"] : undefined })),
          rows: body.length ? body : [colSlice.map(() => null)],
        });
      }
    } else if (cols.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  }

  cols.forEach((c, i) => {
    const column = ws.getColumn(i + 1);
    column.width = Math.min(Math.max(c.name.length + 4, 12), 50);
    // Formato de número do Excel com as casas decimais da coluna (padrão: moeda 2, % 2, número automático).
    const decimals = (c.config as { decimals?: number } | null)?.decimals;
    const frac = (d: number) => (d > 0 ? `.${"0".repeat(d)}` : "");
    if (c.type === "CURRENCY") column.numFmt = `"R$" #,##0${frac(decimals ?? 2)}`;
    else if (c.type === "PERCENT") column.numFmt = `0${frac(decimals ?? 2)}%`;
    else if (c.type === "NUMBER" && decimals !== undefined) column.numFmt = `#,##0${frac(decimals)}`;
    else if (c.type === "DATE") {
      const dateFormat = (c.config as { dateFormat?: string } | null)?.dateFormat;
      column.numFmt = dateFormat === "monthYear" ? "mmmm yyyy" : dateFormat === "long" ? 'd "de" mmmm "de" yyyy' : "dd/mm/yyyy";
    }
  });

  // Fórmulas continuam fórmulas no .xlsx (nomes em inglês e vírgula, como o arquivo guarda),
  // com o último resultado calculado junto — o Excel abre já mostrando o valor e recalcula.
  // Só quando a exportação está na ordem real (sem filtro/ordenação), senão as linhas mudam de lugar.
  if (!query.filters?.length && !query.sort?.length && !query.search) {
    rows.forEach((r, ri) => {
      for (const [colId, internal] of Object.entries(r.formulas ?? {})) {
        const ci = cols.findIndex((c) => c.id === colId);
        if (ci < 0) continue;
        const formula = displayFormula(internal, ri + 2, cols, { english: true }).slice(1);
        if (formula.includes("#REF!")) continue;
        const cell = ws.getCell(ri + 2, ci + 1);
        const result = cell.value;
        cell.value = { formula, result: result instanceof Date || typeof result === "number" || typeof result === "string" || typeof result === "boolean" ? result : undefined } as ExcelJS.CellFormulaValue;
      }
    });
  }

  // Marcações de célula, por cima do estilo da tabela (igual ao Excel).
  rows.forEach((r, ri) => {
    for (const [colId, f] of Object.entries(r.formats ?? {})) {
      const ci = cols.findIndex((c) => c.id === colId);
      if (ci < 0) continue;
      const cell = ws.getCell(ri + 2, ci + 1);
      if (f.b || f.i || f.u || f.s || f.color) cell.font = { ...cell.font, bold: f.b || undefined, italic: f.i || undefined, underline: f.u || undefined, strike: f.s || undefined, color: f.color ? { argb: argb(f.color) } : undefined };
      if (f.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(f.fill) } };
      if (f.align) cell.alignment = { ...cell.alignment, horizontal: f.align };
      if (f.borderTop || f.borderRight || f.borderBottom || f.borderLeft) {
        cell.border = {
          ...cell.border,
          top: xlsxBorder(f.borderTop),
          right: xlsxBorder(f.borderRight),
          bottom: xlsxBorder(f.borderBottom),
          left: xlsxBorder(f.borderLeft),
        };
      }
    }
  });

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer: buffer as ArrayBuffer, sheetName: sheet.name, rowCount: rows.length };
}
