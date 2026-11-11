import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { getCurrentMembership } from "@/lib/current-membership";
import { runWithTenant } from "@/lib/tenant-context";
import { canBypassRegistration, formatQuotaLabel } from "@/lib/deal-registration/rules";
import { parseRequestItems, summarizeRequestItems } from "@/lib/deal-registration/request-rules";
import { brazilDateStringToUTC, brazilEndOfDayUTC } from "@/lib/timezone";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { rateLimitOrResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type Tab = "ready" | "waiting" | "done" | "all";

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function GET(request: Request) {
  const membership = await getCurrentMembership();
  if (!membership?.active || !canBypassRegistration(membership)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const limited = rateLimitOrResponse(`cadastros-export:${membership.userId}`, 6, 60_000);
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const rawTab = params.get("tab");
  const tab: Tab = rawTab === "ready" || rawTab === "waiting" || rawTab === "done" ? rawTab : "all";
  const q = (params.get("q") ?? "").trim().slice(0, 120);
  const consultantId = params.get("consultantId")?.slice(0, 100) || undefined;
  const administratorId = params.get("administratorId")?.slice(0, 100) || undefined;
  const fromRaw = params.get("from");
  const toRaw = params.get("to");
  if ((fromRaw && !validDate(fromRaw)) || (toRaw && !validDate(toRaw))) {
    return NextResponse.json({ error: "Data inválida" }, { status: 400 });
  }
  if (fromRaw && toRaw && fromRaw > toRaw) {
    return NextResponse.json({ error: "A data inicial deve ser anterior à data final" }, { status: 400 });
  }

  const start = fromRaw ? brazilDateStringToUTC(fromRaw) : undefined;
  const end = toRaw ? brazilEndOfDayUTC(toRaw) : undefined;
  const range = { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
  const and: Prisma.DealWhereInput[] = [];

  if (tab === "done") and.push({ registration: { is: { quotaRegisteredAt: { not: null } } } });
  if (tab === "ready") {
    and.push({ registration: { is: { quotaRegisteredAt: null } } });
    and.push({ documentRequests: { none: { status: "OPEN" } } });
  }
  if (tab === "waiting") {
    and.push({ registration: { is: { quotaRegisteredAt: null } } });
    and.push({ documentRequests: { some: { status: "OPEN" } } });
  }
  if (consultantId) and.push({ ownerId: consultantId });
  if (administratorId) and.push({ administratorId });
  if (start || end) {
    if (tab === "done") {
      and.push({ registration: { is: { quotaRegisteredAt: range } } });
    } else if (tab === "ready" || tab === "waiting") {
      and.push({ closedAt: range });
    } else {
      and.push({
        OR: [
          { registration: { is: { quotaRegisteredAt: range } } },
          { registration: { is: { quotaRegisteredAt: null } }, closedAt: range },
        ],
      });
    }
  }
  if (q) {
    and.push({
      OR: [
        { contact: { name: { contains: q, mode: "insensitive" } } },
        { owner: { name: { contains: q, mode: "insensitive" } } },
        { administrator: { name: { contains: q, mode: "insensitive" } } },
        { registration: { is: { holderName: { contains: q, mode: "insensitive" } } } },
        { registration: { is: { groupNumber: { contains: q, mode: "insensitive" } } } },
        { registration: { is: { quotaNumber: { contains: q, mode: "insensitive" } } } },
      ],
    });
  }

  const deals = await runWithTenant(membership.organizationId, () => prisma.deal.findMany({
    where: { organizationId: membership.organizationId, status: "WON", AND: and },
    orderBy: [{ closedAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      value: true,
      grossValue: true,
      closedAt: true,
      contact: { select: { name: true } },
      owner: { select: { name: true } },
      administrator: { select: { name: true } },
      registration: {
        select: {
          holderName: true,
          groupNumber: true,
          quotaNumber: true,
          quotaDigit: true,
          quotaRegisteredAt: true,
          documents: { select: { id: true } },
        },
      },
      documentRequests: { where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 1, select: { items: true } },
    },
  }));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CRM";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Cadastros");
  sheet.columns = [
    { header: "Cliente / titular", key: "holder", width: 34 },
    { header: "Nome no CRM", key: "client", width: 30 },
    { header: "Administradora", key: "administrator", width: 24 },
    { header: "Consultor", key: "consultant", width: 25 },
    { header: "Crédito (R$)", key: "credit", width: 17, style: { numFmt: '"R$" #,##0.00' } },
    { header: "Grupo / cota", key: "quota", width: 24 },
    { header: "Situação", key: "state", width: 22 },
    { header: "Data do ganho", key: "closedAt", width: 16, style: { numFmt: "dd/mm/yyyy hh:mm" } },
    { header: "Data do cadastro", key: "quotaAt", width: 18, style: { numFmt: "dd/mm/yyyy hh:mm" } },
    { header: "Documentos", key: "documents", width: 13 },
    { header: "Aguardando", key: "waitingFor", width: 36 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5148D9" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = "A1:K1";

  for (const deal of deals) {
    const reg = deal.registration;
    const openRequest = deal.documentRequests[0];
    const isDone = Boolean(reg?.quotaRegisteredAt);
    sheet.addRow({
      holder: sanitizeCell(reg?.holderName?.trim() || deal.contact.name),
      client: sanitizeCell(deal.contact.name),
      administrator: sanitizeCell(deal.administrator?.name ?? ""),
      consultant: sanitizeCell(deal.owner.name),
      credit: deal.grossValue != null ? Number(deal.grossValue) : deal.value != null ? Number(deal.value) : null,
      quota: sanitizeCell(reg ? formatQuotaLabel(reg) : ""),
      state: isDone ? "Cota cadastrada" : openRequest ? "Aguardando consultor" : "Para cadastrar",
      closedAt: deal.closedAt,
      quotaAt: reg?.quotaRegisteredAt,
      documents: reg?.documents.length ?? 0,
      waitingFor: openRequest ? sanitizeCell(summarizeRequestItems(parseRequestItems(openRequest.items), 5)) : "",
    });
  }
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: "middle" };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="cadastros-${tab}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
