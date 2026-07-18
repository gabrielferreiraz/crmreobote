import { PassThrough, Readable } from "node:stream";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 500;

/**
 * Busca e escreve em lotes, direto no stream de saída, em vez de um
 * `findMany` sem limite + workbook inteiro em memória — uma organização com
 * uma base grande não faz o servidor segurar tudo de uma vez antes do
 * primeiro byte sair. `useStyles: true` é obrigatório aqui: sem ele o
 * WorkbookWriter em modo stream ignora o negrito do cabeçalho em silêncio.
 */
async function writeContactsWorkbook(organizationId: string, output: PassThrough) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useStyles: true });
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

  await runWithTenant(organizationId, async () => {
    let skip = 0;
    for (;;) {
      const batch = await prisma.contact.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        skip,
        take: BATCH_SIZE,
      });
      if (batch.length === 0) break;

      for (const contact of batch) {
        sheet
          .addRow({
            name: sanitizeCell(contact.name),
            email: sanitizeCell(contact.email ?? ""),
            phone: sanitizeCell(contact.phone ?? ""),
            whatsapp: sanitizeCell(contact.whatsapp ?? ""),
            source: sanitizeCell(contact.source ?? ""),
            company: sanitizeCell(contact.company ?? ""),
            tags: sanitizeCell(contact.tags.join(", ")),
            createdAt: contact.createdAt.toLocaleDateString("pt-BR"),
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
      { error: "Apenas o dono da organização pode exportar contatos" },
      { status: 403 },
    );
  }

  const passThrough = new PassThrough();

  // Não espera terminar antes de responder — a Response já vai com o stream
  // (Readable.toWeb), e o navegador começa a receber bytes enquanto os
  // lotes seguintes ainda estão sendo buscados/escritos.
  writeContactsWorkbook(access.organizationId, passThrough).catch((err) => {
    console.error("[export] falha ao gerar planilha de contatos", err);
    passThrough.destroy(err instanceof Error ? err : new Error(String(err)));
  });

  return new NextResponse(Readable.toWeb(passThrough) as ReadableStream, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="contatos.xlsx"`,
    },
  });
}
