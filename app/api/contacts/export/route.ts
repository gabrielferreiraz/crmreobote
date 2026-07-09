import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireRole(["OWNER"]);
  if (!access.ok) {
    return NextResponse.json(
      { error: "Apenas o dono da organização pode exportar contatos" },
      { status: 403 },
    );
  }

  const contacts = await runWithTenant(access.organizationId, () =>
    prisma.contact.findMany({
      where: { organizationId: access.organizationId },
      orderBy: { createdAt: "desc" },
    }),
  );

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Contatos");

  sheet.columns = [
    { header: "Nome", key: "name", width: 30 },
    { header: "E-mail", key: "email", width: 28 },
    { header: "Celular", key: "phone", width: 18 },
    { header: "WhatsApp", key: "whatsapp", width: 18 },
    { header: "Origem", key: "source", width: 16 },
    { header: "Empresa", key: "company", width: 24 },
    { header: "Tags", key: "tags", width: 24 },
    { header: "Criado em", key: "createdAt", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const contact of contacts) {
    sheet.addRow({
      name: sanitizeCell(contact.name),
      email: sanitizeCell(contact.email ?? ""),
      phone: sanitizeCell(contact.phone ?? ""),
      whatsapp: sanitizeCell(contact.whatsapp ?? ""),
      source: sanitizeCell(contact.source ?? ""),
      company: sanitizeCell(contact.company ?? ""),
      tags: sanitizeCell(contact.tags.join(", ")),
      createdAt: contact.createdAt.toLocaleDateString("pt-BR"),
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="contatos.xlsx"`,
    },
  });
}
