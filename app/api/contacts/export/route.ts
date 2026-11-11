import { PassThrough, Readable } from "node:stream";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { runWithTenant } from "@/lib/tenant-context";
import { buildContactDealWhere, buildContactsWhere, type ContactsFilterParams } from "@/lib/contacts/list-query";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 500;

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseNonNegativeNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function asPresenceFilter(value: string | null): "yes" | "no" | undefined {
  return value === "yes" || value === "no" ? value : undefined;
}

function asDealStatus(value: string | null): "OPEN" | "WON" | "LOST" | undefined {
  return value === "OPEN" || value === "WON" || value === "LOST" ? value : undefined;
}

function dealStatusLabel(status: "OPEN" | "WON" | "LOST" | undefined): string {
  if (status === "WON") return "Ganho";
  if (status === "LOST") return "Perdido";
  return status === "OPEN" ? "Em andamento" : "";
}

async function writeContactsWorkbook(filterParams: ContactsFilterParams, output: PassThrough) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useStyles: true });
  const sheet = workbook.addWorksheet("Clientes");

  sheet.columns = [
    { header: "Nome", key: "name", width: 30 },
    { header: "E-mail", key: "email", width: 28 },
    { header: "Celular", key: "phone", width: 18 },
    { header: "WhatsApp", key: "whatsapp", width: 18 },
    { header: "Empresa", key: "company", width: 24 },
    { header: "Cargo", key: "jobTitle", width: 20 },
    { header: "Origem", key: "source", width: 18 },
    { header: "Consultor", key: "consultant", width: 24 },
    { header: "Negócio", key: "deal", width: 30 },
    { header: "Situação", key: "status", width: 16 },
    { header: "Valor", key: "value", width: 18, style: { numFmt: '"R$" #,##0.00' } },
    { header: "Grupo", key: "group", width: 14 },
    { header: "Cota", key: "quota", width: 14 },
    { header: "Dígito", key: "digit", width: 10 },
    { header: "Tags", key: "tags", width: 24 },
    { header: "Criado em", key: "createdAt", width: 16 },
  ];
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
  header.commit();
  sheet.autoFilter = { from: "A1", to: "P1" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  await runWithTenant(filterParams.organizationId, async () => {
    const where = buildContactsWhere(filterParams);
    const dealWhere = buildContactDealWhere(filterParams);
    let skip = 0;

    for (;;) {
      const batch = await prisma.contact.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: BATCH_SIZE,
        select: {
          name: true,
          email: true,
          phone: true,
          whatsapp: true,
          company: true,
          jobTitle: true,
          source: true,
          tags: true,
          createdAt: true,
          responsavel: { select: { name: true } },
          deals: {
            ...(dealWhere ? { where: dealWhere } : {}),
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              name: true,
              status: true,
              value: true,
              grossValue: true,
              owner: { select: { name: true } },
              registration: { select: { groupNumber: true, quotaNumber: true, quotaDigit: true } },
              process: { select: { groupNumber: true, quotaNumber: true } },
            },
          },
        },
      });
      if (batch.length === 0) break;

      for (const contact of batch) {
        const deal = contact.deals[0];
        const administrativeView = Boolean(filterParams.dealStatus || filterParams.dealOwnerId);
        sheet.addRow({
          name: sanitizeCell(contact.name),
          email: sanitizeCell(contact.email ?? ""),
          phone: sanitizeCell(contact.phone ?? ""),
          whatsapp: sanitizeCell(contact.whatsapp ?? ""),
          company: sanitizeCell(contact.company ?? ""),
          jobTitle: sanitizeCell(contact.jobTitle ?? ""),
          source: sanitizeCell(contact.source ?? ""),
          consultant: sanitizeCell((administrativeView ? deal?.owner.name : contact.responsavel?.name) ?? ""),
          deal: sanitizeCell(deal?.name ?? ""),
          status: dealStatusLabel(deal?.status),
          value: deal ? Number(deal.grossValue ?? deal.value ?? 0) : null,
          group: sanitizeCell(deal?.registration?.groupNumber ?? deal?.process?.groupNumber ?? ""),
          quota: sanitizeCell(deal?.registration?.quotaNumber ?? deal?.process?.quotaNumber ?? ""),
          digit: sanitizeCell(deal?.registration?.quotaDigit ?? ""),
          tags: sanitizeCell(contact.tags.join(", ")),
          createdAt: contact.createdAt.toLocaleDateString("pt-BR"),
        }).commit();
      }

      if (batch.length < BATCH_SIZE) break;
      skip += BATCH_SIZE;
    }
  });

  await sheet.commit();
  await workbook.commit();
}

export async function GET(req: Request) {
  const membership = await getCurrentMembership();
  const canExport = membership?.active && (membership.role === "OWNER" || membership.area === "ADMINISTRATIVO");
  if (!membership || !canExport) {
    return NextResponse.json({ error: "Apenas Donos e o Administrativo podem exportar clientes" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const filterParams: ContactsFilterParams = {
    organizationId: membership.organizationId,
    q: searchParams.get("q") ?? undefined,
    source: searchParams.get("source") ?? undefined,
    jobTitle: searchParams.get("jobTitle") ?? undefined,
    responsavelId: searchParams.get("responsavelId") ?? undefined,
    dealOwnerId: searchParams.get("dealOwnerId") ?? undefined,
    dealStatus: asDealStatus(searchParams.get("dealStatus")),
    state: searchParams.get("state") ?? undefined,
    city: searchParams.get("city") ?? undefined,
    tag: searchParams.get("tag") ?? undefined,
    onlyWithDeals: searchParams.get("onlyWithDeals") === "1",
    dealValueMin: parseNonNegativeNumber(searchParams.get("dealValueMin")),
    dealValueMax: parseNonNegativeNumber(searchParams.get("dealValueMax")),
    groupNumber: searchParams.get("groupNumber")?.trim() || undefined,
    hasEmail: asPresenceFilter(searchParams.get("hasEmail")),
    hasWhatsapp: asPresenceFilter(searchParams.get("hasWhatsapp")),
    registeredFrom: parseDate(searchParams.get("registeredFrom")),
    registeredTo: parseDate(searchParams.get("registeredTo")),
    updatedFrom: parseDate(searchParams.get("updatedFrom")),
    updatedTo: parseDate(searchParams.get("updatedTo")),
  };

  const passThrough = new PassThrough();
  writeContactsWorkbook(filterParams, passThrough).catch((error) => {
    console.error("[export] falha ao gerar planilha de clientes", error);
    passThrough.destroy(error instanceof Error ? error : new Error(String(error)));
  });

  return new NextResponse(Readable.toWeb(passThrough) as ReadableStream, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="clientes.xlsx"',
    },
  });
}
