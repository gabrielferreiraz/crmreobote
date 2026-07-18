import ExcelJS from "exceljs";
import { Readable } from "stream";
import { sanitizeCell } from "@/lib/csv-sanitize";

/**
 * Excel/Google Sheets em português do Brasil salva CSV com ";" (porque "," já
 * é o separador decimal no locale pt-BR) — sem detectar isso, o arquivo
 * inteiro vira uma célula só por linha e nenhuma coluna esperada é
 * encontrada. Conta os dois separadores só na 1ª linha (cabeçalho, que
 * dificilmente tem vírgula/ponto-e-vírgula dentro de um valor de célula) e
 * usa quem aparecer mais.
 */
function detectCsvDelimiter(buffer: Buffer): string {
  const firstLine = buffer.toString("utf-8").split(/\r?\n/, 1)[0] ?? "";
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

export async function parseSpreadsheet(buffer: Buffer, filename: string): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  const lowerFilename = filename.toLowerCase();
  const isCsv = lowerFilename.endsWith(".csv");

  if (!isCsv && lowerFilename.endsWith(".xls")) {
    // .xls (Excel 97-2003, formato binário legado) não é OOXML — workbook.xlsx.load
    // lançaria um erro genérico de "arquivo corrompido" sem dizer o motivo real.
    throw new Error("XLS_NOT_SUPPORTED");
  }

  let worksheet: ExcelJS.Worksheet | undefined;
  if (isCsv) {
    const delimiter = detectCsvDelimiter(buffer);
    worksheet = await workbook.csv.read(Readable.from(buffer), { parserOptions: { delimiter } });
  } else {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    worksheet = workbook.worksheets[0];
  }

  if (!worksheet) return [];

  const rows: string[][] = [];
  worksheet.eachRow((row) => {
    const values = row.values as unknown[];
    const cells = values
      .slice(1)
      .map((v) => (v === null || v === undefined ? "" : sanitizeCell(String(v).trim())));
    rows.push(cells);
  });
  return rows;
}

export function normalizeHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}
