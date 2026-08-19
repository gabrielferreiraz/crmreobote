import { PassThrough, Readable } from "node:stream";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { runWithTenant } from "@/lib/tenant-context";
import { buildDealsWhere, type DealsFilterParams } from "@/lib/deals/list-query";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 500;

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

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
async function writeDealsWorkbook(filterParams: DealsFilterParams, output: PassThrough) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useStyles: true });
  const sheet = workbook.addWorksheet("Negócios");

  sheet.columns = [
    { header: "Nome", key: "name", width: 32 },
    { header: "Contato", key: "contact", width: 26 },
    { header: "WhatsApp", key: "phone", width: 16 },
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

  await runWithTenant(filterParams.organizationId, async () => {
    const where = buildDealsWhere(filterParams);
    let skip = 0;
    for (;;) {
      const batch = await prisma.deal.findMany({
        where,
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
            // Prioriza WhatsApp — é o número usado de verdade pra mandar
            // mensagem (importar numa lista de disparo, etc.); só cai pro
            // celular comum quando o contato não tem WhatsApp cadastrado.
            phone: sanitizeCell(deal.contact.whatsapp || deal.contact.phone || ""),
            pipeline: sanitizeCell(deal.pipeline.name),
            stage: sanitizeCell(deal.stage.name),
            status: STATUS_LABEL[deal.status] ?? deal.status,
            owner: sanitizeCell(deal.owner.name),
            value: deal.value ? Number(deal.value) : "",
            creditType: sanitizeCell(deal.creditType ?? ""),
            lossReason: sanitizeCell(deal.lossReason?.label ?? deal.lostReason ?? ""),
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

export async function GET(req: Request) {
  const access = await requireRole(["OWNER"]);
  if (!access.ok) {
    return NextResponse.json(
      { error: "Apenas o dono da organização pode exportar negócios" },
      { status: 403 },
    );
  }

  // Mesmos filtros da Lista (ver GET /api/deals) — sem isso, o botão
  // "Exportar" sempre baixava o pipeline inteiro, ignorando qualquer
  // busca/filtro aplicado na tela. Dono sempre enxerga tudo (scope "all",
  // mesma regra de getDealScope pra role OWNER) — não precisa de uma consulta
  // extra só pra confirmar isso.
  const { searchParams } = new URL(req.url);
  const ownerIdParam = searchParams.get("ownerId");
  const filterParams: DealsFilterParams = {
    organizationId: access.organizationId,
    scope: { type: "all" },
    pipelineId: searchParams.get("pipelineId") ?? undefined,
    status: (searchParams.get("status") as "OPEN" | "WON" | "LOST" | null) ?? undefined,
    q: searchParams.get("q") ?? undefined,
    ownerIds: ownerIdParam ? ownerIdParam.split(",").filter(Boolean) : undefined,
    stageId: searchParams.get("stageId") ?? undefined,
    lossReasonId: searchParams.get("lossReasonId") ?? undefined,
    jobTitle: searchParams.get("jobTitle") ?? undefined,
    source: searchParams.get("source") ?? undefined,
    state: searchParams.get("state") ?? undefined,
    city: searchParams.get("city") ?? undefined,
    createdFrom: parseDate(searchParams.get("createdFrom")),
    createdTo: parseDate(searchParams.get("createdTo")),
    closedFrom: parseDate(searchParams.get("closedFrom")),
    closedTo: parseDate(searchParams.get("closedTo")),
  };

  const passThrough = new PassThrough();

  writeDealsWorkbook(filterParams, passThrough).catch((err) => {
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
