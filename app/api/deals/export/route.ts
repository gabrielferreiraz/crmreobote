import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Em andamento",
  WON: "Ganho",
  LOST: "Perdido",
};

export async function GET() {
  const access = await requireRole(["OWNER"]);
  if (!access.ok) {
    return NextResponse.json(
      { error: "Apenas o dono da organização pode exportar negócios" },
      { status: 403 },
    );
  }

  const deals = await runWithTenant(access.organizationId, () =>
    prisma.deal.findMany({
      where: { organizationId: access.organizationId },
      orderBy: { createdAt: "desc" },
      include: { contact: true, owner: true, stage: true, pipeline: true, lossReason: true },
    }),
  );

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Negócios");

  sheet.columns = [
    { header: "Nome", key: "name", width: 32 },
    { header: "Contato", key: "contact", width: 26 },
    { header: "Celular", key: "phone", width: 16 },
    { header: "Pipeline", key: "pipeline", width: 18 },
    { header: "Etapa", key: "stage", width: 18 },
    { header: "Status", key: "status", width: 14 },
    { header: "Responsável", key: "owner", width: 20 },
    { header: "Valor", key: "value", width: 14 },
    { header: "Tipo de crédito", key: "creditType", width: 16 },
    { header: "Prazo (meses)", key: "creditTerm", width: 14 },
    { header: "Grupo", key: "groupNumber", width: 12 },
    { header: "Cota", key: "quota", width: 12 },
    { header: "Motivo da perda", key: "lossReason", width: 24 },
    { header: "Criado em", key: "createdAt", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const deal of deals) {
    sheet.addRow({
      name: sanitizeCell(deal.name),
      contact: sanitizeCell(deal.contact.name),
      phone: sanitizeCell(deal.contact.phone ?? ""),
      pipeline: sanitizeCell(deal.pipeline.name),
      stage: sanitizeCell(deal.stage.name),
      status: STATUS_LABEL[deal.status] ?? deal.status,
      owner: sanitizeCell(deal.owner.name),
      value: deal.value ? Number(deal.value) : "",
      creditType: sanitizeCell(deal.creditType ?? ""),
      creditTerm: deal.creditTerm ?? "",
      groupNumber: sanitizeCell(deal.groupNumber ?? ""),
      quota: sanitizeCell(deal.quota ?? ""),
      lossReason: sanitizeCell(deal.lossReason?.label ?? ""),
      createdAt: deal.createdAt.toLocaleDateString("pt-BR"),
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="negocios.xlsx"`,
    },
  });
}
