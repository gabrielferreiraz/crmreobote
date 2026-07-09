import ExcelJS from "exceljs";
import { Readable } from "stream";
import { sanitizeCell } from "@/lib/csv-sanitize";

export async function parseSpreadsheet(buffer: Buffer, filename: string): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  const isCsv = filename.toLowerCase().endsWith(".csv");

  let worksheet: ExcelJS.Worksheet | undefined;
  if (isCsv) {
    worksheet = await workbook.csv.read(Readable.from(buffer));
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
