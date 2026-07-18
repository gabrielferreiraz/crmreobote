import { PassThrough, Readable } from "node:stream";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 500;

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Em andamento",
  WON: "Ganho",
  LOST: "Perdido",
};

/**
 * Mesma ideia de app/api/contacts/export/route.ts: busca em lotes e escreve
 * direto no stream de saída, em vez de um `findMany` sem limite (com 4
 * relações por linha) + workbook inteiro em memória.
 */
async function writeDealsWorkbook(organizationId: string, output: PassThrough) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useStyles: true });
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
    { header: "Motivo da perda", key: "lossReason", width: 24 },
    { header: "Criado em", key: "createdAt", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };

  await runWithTenant(organizationId, async () => {
    let skip = 0;
    for (;;) {
      const batch = await prisma.deal.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        skip,
        take: BATCH_SIZE,
        include: { contact: true, owner: true, stage: true, pipeline: true, lossReason: true },
      });
      if (batch.length === 0) break;

      for (const deal of batch) {
        sheet
          .addRow({
            name: sanitizeCell(deal.name),
            contact: sanitizeCell(deal.contact.name),
            phone: sanitizeCell(deal.contact.phone ?? ""),
            pipeline: sanitizeCell(deal.pipeline.name),
            stage: sanitizeCell(deal.stage.name),
            status: STATUS_LABEL[deal.status] ?? deal.status,
            owner: sanitizeCell(deal.owner.name),
            value: deal.value ? Number(deal.value) : "",
            creditType: sanitizeCell(deal.creditType ?? ""),
            lossReason: sanitizeCell(deal.lossReason?.label ?? ""),
            createdAt: deal.createdAt.toLocaleDateString("pt-BR"),
          })
          .commit();
      }

      if (batch.length < BATCH_SIZE) break;
      skip += BATCH_SIZE;
    }
  });

  await sheet.commit();
  await workbook.commit();
}

export async function GET() {
  const access = await requireRole(["OWNER"]);
  if (!access.ok) {
    return NextResponse.json(
      { error: "Apenas o dono da organização pode exportar negócios" },
      { status: 403 },
    );
  }

  const passThrough = new PassThrough();

  writeDealsWorkbook(access.organizationId, passThrough).catch((err) => {
    console.error("[export] falha ao gerar planilha de negócios", err);
    passThrough.destroy(err instanceof Error ? err : new Error(String(err)));
  });

  return new NextResponse(Readable.toWeb(passThrough) as ReadableStream, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="negocios.xlsx"`,
    },
  });
}
