/**
 * Leitura crua de XLSX compartilhada pelas fases de importação — acesso por
 * ÍNDICE de coluna (não por nome virando chave de objeto), de propósito:
 * os exports de Negócios/Tarefas do Agendor têm a coluna "WhatsApp"
 * duplicada (nível do negócio, sempre vazia, e nível da pessoa, com o dado
 * de verdade) — um objeto `{[header]: valor}` colidiria as duas.
 */

import ExcelJS from "exceljs";

export async function loadSheet(filePath: string): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error(`Planilha vazia ou inválida: ${filePath}`);
  return sheet;
}

export function getHeaders(sheet: ExcelJS.Worksheet): string[] {
  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? `col${colNumber}`);
  });
  return headers;
}

/** Índice (1-based) da N-ésima ocorrência de um cabeçalho — `occurrence=2` pega a 2ª coluna "WhatsApp", por exemplo. Lança se não encontrar (falha alto, não silencioso). */
export function colIndex(headers: string[], name: string, occurrence = 1): number {
  let count = 0;
  for (let i = 1; i < headers.length; i++) {
    if (headers[i] === name) {
      count++;
      if (count === occurrence) return i;
    }
  }
  throw new Error(`Coluna "${name}" (ocorrência ${occurrence}) não encontrada nos cabeçalhos: ${headers.filter(Boolean).join(", ")}`);
}

export function cellText(row: ExcelJS.Row, idx: number): string | null {
  const v = row.getCell(idx).value;
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

export function cellDate(row: ExcelJS.Row, idx: number): Date | null {
  const v = row.getCell(idx).value;
  if (v instanceof Date) return v;
  return null;
}

export function cellNumber(row: ExcelJS.Row, idx: number): number | null {
  const v = row.getCell(idx).value;
  return typeof v === "number" ? v : null;
}
