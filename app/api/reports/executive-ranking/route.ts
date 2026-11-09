import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { requireRole } from "@/lib/require-role";
import { getExecutiveReportData } from "@/lib/reports/executive-data";
import { EXECUTIVE_MONTHS_LONG } from "@/lib/reports/executive-utils";

export const dynamic = "force-dynamic";

const MONEY_FORMAT = '[$R$-pt-BR] #,##0.00;[Red]-[$R$-pt-BR] #,##0.00';
const PERCENT_FORMAT = "0.00%";
const HEADER_ROW = 5;

export async function GET(request: Request) {
  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const selectedMonth = parseInteger(params.get("month"));
  const data = await getExecutiveReportData(access.organizationId, {
    startYear: parseInteger(params.get("fromYear")),
    endYear: parseInteger(params.get("toYear")),
    throughMonth: selectedMonth === undefined ? undefined : selectedMonth - 1,
  });

  const years = data.yearlySeries.map((series) => series.year);
  const includesPeriodTotal = years.length > 1;
  const totalColumns = 3 + years.length + (includesPeriodTotal ? 1 : 0) + 4;
  const selectedTotal = roundMoney(data.comparisonRanking.reduce((sum, row) => sum + row.totalValue, 0));
  const yearTotals = new Map(
    years.map((year) => [
      year,
      roundMoney(data.comparisonRanking.reduce(
        (sum, row) => sum + (row.yearlyValues.find((item) => item.year === year)?.value ?? 0),
        0,
      )),
    ]),
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CRM Reobote";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.subject = `Ranking executivo de vendedores — ${years[0]} a ${years.at(-1)}`;

  const sheet = workbook.addWorksheet("Ranking de vendedores", {
    properties: { defaultRowHeight: 22 },
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });

  sheet.columns = [
    { key: "position", width: 10 },
    { key: "seller", width: 34 },
    { key: "team", width: 24 },
    ...years.map((year) => ({ key: yearKey(year), width: 20 })),
    ...(includesPeriodTotal ? [{ key: "periodTotal", width: 22 }] : []),
    { key: "share", width: 19 },
    { key: "sales", width: 23 },
    { key: "activeMonths", width: 18 },
    { key: "average", width: 22 },
  ];

  sheet.mergeCells(1, 1, 1, totalColumns);
  const title = sheet.getCell(1, 1);
  title.value = "Ranking executivo de vendedores";
  title.font = { name: "Aptos Display", size: 20, bold: true, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17171C" } };
  title.alignment = { vertical: "middle", horizontal: "left" };
  sheet.getRow(1).height = 36;

  const generatedAtColumn = totalColumns - 2;
  sheet.mergeCells(2, 1, 2, generatedAtColumn - 1);
  sheet.getCell(2, 1).value = comparisonPeriodLabel(years, data.throughMonth);
  sheet.getCell(2, 1).font = { size: 12, bold: true, color: { argb: "FF3F3F46" } };
  sheet.mergeCells(2, generatedAtColumn, 2, totalColumns);
  sheet.getCell(2, generatedAtColumn).value = `Gerado em ${formatGeneratedAt(data.updatedAt)}`;
  sheet.getCell(2, generatedAtColumn).font = { size: 10, color: { argb: "FF71717A" } };
  sheet.getCell(2, generatedAtColumn).alignment = { horizontal: "right" };

  sheet.mergeCells(3, 1, 3, totalColumns);
  sheet.getCell(3, 1).value = `Cada ano usa janeiro a ${EXECUTIVE_MONTHS_LONG[data.throughMonth].toLocaleLowerCase("pt-BR")}. Negócios divididos aparecem para cada participante somente com sua parcela. A equipe exibida é a atual.`;
  sheet.getCell(3, 1).font = { size: 10, italic: true, color: { argb: "FF71717A" } };

  const headers = [
    "Posição",
    "Vendedor",
    "Equipe atual",
    ...years.map((year) => `Vendas ${year}`),
    ...(includesPeriodTotal ? ["Total do período"] : []),
    "Participação no período",
    "Participações em ganhos",
    "Meses com venda",
    "Média por participação",
  ];
  const header = sheet.getRow(HEADER_ROW);
  header.values = headers;
  header.height = 30;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: "FF3730A3" } } };
  });

  data.comparisonRanking.forEach((ranking, index) => {
    const rowData: Record<string, string | number> = {
      position: index + 1,
      seller: sanitizeCell(ranking.name),
      team: sanitizeCell(ranking.team),
      share: selectedTotal > 0 ? ranking.totalValue / selectedTotal : 0,
      sales: ranking.sales,
      activeMonths: ranking.activeMonths,
      average: ranking.sales > 0 ? ranking.totalValue / ranking.sales : 0,
    };
    for (const yearlyValue of ranking.yearlyValues) {
      rowData[yearKey(yearlyValue.year)] = yearlyValue.value;
    }
    if (includesPeriodTotal) rowData.periodTotal = ranking.totalValue;

    const row = sheet.addRow(rowData);
    styleDataRow(row, index);
  });

  const firstDataRow = HEADER_ROW + 1;
  const lastDataRow = HEADER_ROW + data.comparisonRanking.length;
  if (data.comparisonRanking.length > 0) {
    sheet.autoFilter = {
      from: `A${HEADER_ROW}`,
      to: sheet.getCell(lastDataRow, totalColumns).address,
    };
  }

  const totalParticipations = data.comparisonRanking.reduce((sum, row) => sum + row.sales, 0);
  const totalRowData: Record<string, string | number> = {
    position: "TOTAL",
    share: selectedTotal > 0 ? 1 : 0,
    sales: totalParticipations,
    activeMonths: "—",
    average: totalParticipations > 0 ? selectedTotal / totalParticipations : 0,
  };
  for (const year of years) totalRowData[yearKey(year)] = yearTotals.get(year) ?? 0;
  if (includesPeriodTotal) totalRowData.periodTotal = selectedTotal;

  const totalRow = sheet.addRow(totalRowData);
  sheet.mergeCells(totalRow.number, 1, totalRow.number, 3);
  totalRow.height = 28;
  totalRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FF18181B" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDE9FE" } };
    cell.border = { top: { style: "medium", color: { argb: "FF7C3AED" } } };
  });

  for (const year of years) sheet.getColumn(yearKey(year)).numFmt = MONEY_FORMAT;
  if (includesPeriodTotal) sheet.getColumn("periodTotal").numFmt = MONEY_FORMAT;
  sheet.getColumn("share").numFmt = PERCENT_FORMAT;
  sheet.getColumn("sales").numFmt = "0";
  sheet.getColumn("activeMonths").numFmt = "0";
  sheet.getColumn("average").numFmt = MONEY_FORMAT;
  for (let rowNumber = firstDataRow; rowNumber <= totalRow.number; rowNumber += 1) {
    for (let columnNumber = 4; columnNumber <= totalColumns; columnNumber += 1) {
      sheet.getCell(rowNumber, columnNumber).alignment = { horizontal: "right", vertical: "middle" };
    }
  }
  sheet.views = [{ state: "frozen", xSplit: 3, ySplit: HEADER_ROW, topLeftCell: `D${firstDataRow}` }];
  sheet.headerFooter.oddFooter = "&LCRM Reobote&CConfidencial&R&P de &N";

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ranking-vendedores-${years[0]}-${years.at(-1)}-ate-${data.throughMonthLabel}.xlsx"`,
    },
  });
}

function styleDataRow(row: ExcelJS.Row, index: number) {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { size: 11, color: { argb: "FF27272A" } };
    cell.alignment = { vertical: "middle" };
    cell.border = { bottom: { style: "hair", color: { argb: "FFE4E4E7" } } };
    if (index % 2 === 1) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFAFAFA" } };
    }
  });

  const rankCell = row.getCell(1);
  rankCell.alignment = { horizontal: "center", vertical: "middle" };
  rankCell.font = { bold: true, color: { argb: rankColor(index) } };
}

function rankColor(index: number): string {
  if (index === 0) return "FFB45309";
  if (index === 1) return "FF2563EB";
  if (index === 2) return "FFEA580C";
  return "FF71717A";
}

function yearKey(year: number): string {
  return `year_${year}`;
}

function comparisonPeriodLabel(years: number[], throughMonth: number): string {
  const month = EXECUTIVE_MONTHS_LONG[throughMonth].toLocaleLowerCase("pt-BR");
  if (years.length === 1) return `Janeiro a ${month} de ${years[0]}`;
  return `Janeiro a ${month} · ${years[0]}–${years.at(-1)}`;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseInteger(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

function formatGeneratedAt(value: string): string {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Cuiaba",
  });
}
