import { NextResponse } from "next/server";
import { prisma, prismaRaw } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/** Detalhe de um lote — usado pelo "ver detalhes" do histórico (linhas que não viraram contato, com o motivo de cada uma).
 * Mesma regra da lista (GET /api/contacts/import/history): só quem criou o lote acessa, sem exceção de papel. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const batch = await prisma.importBatch.findFirst({
      where: { id, organizationId: access.organizationId, createdById: access.userId },
      include: { createdBy: { select: { name: true } } },
    });
    if (!batch) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    return NextResponse.json({
      id: batch.id,
      fileName: batch.fileName,
      rowsTotal: batch.rowsTotal,
      rowsCreated: batch.rowsCreated,
      rowsSkipped: batch.rowsSkipped,
      createdAt: batch.createdAt,
      deletedAt: batch.deletedAt,
      createdByName: batch.createdBy.name,
      issueRows: batch.issueRows ?? [],
    });
  });
}

/**
 * Desfaz uma importação de contato — só quando é seguro: nenhum contato
 * criado por ela pode ter ganho negócio, tarefa, atividade, conversa de
 * WhatsApp, envio de campanha ou processo desde então (mesmo espírito de
 * DELETE /api/deals/import/[id], adaptado pra contato — aqui não existe
 * negócio pra desfazer junto, contato criado por importação de CONTATO
 * nunca vem com negócio nenhum). Se algum contato do lote já foi usado, a
 * operação inteira é recusada (nada é apagado pela metade).
 *
 * O registro do ImportBatch em si NUNCA é apagado (só marcado deletedAt) —
 * é o próprio rastro de auditoria que essa importação existiu e foi
 * desfeita.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const batch = await prisma.importBatch.findFirst({
      where: { id, organizationId: access.organizationId, createdById: access.userId },
    });
    if (!batch) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    if (batch.deletedAt) return NextResponse.json({ error: "Essa importação já foi desfeita" }, { status: 409 });

    const contacts = await prisma.contact.findMany({
      where: { organizationId: access.organizationId, importBatchId: id },
      select: {
        id: true,
        name: true,
        _count: {
          select: { deals: true, tasks: true, activities: true, whatsappThreads: true, campaignRecipients: true, processes: true },
        },
      },
    });

    const blocking = contacts.filter(
      (c) =>
        c._count.deals > 0 ||
        c._count.tasks > 0 ||
        c._count.activities > 0 ||
        c._count.whatsappThreads > 0 ||
        c._count.campaignRecipients > 0 ||
        c._count.processes > 0,
    );
    if (blocking.length > 0) {
      return NextResponse.json(
        {
          error: `${blocking.length} contato${blocking.length === 1 ? "" : "s"} já ${blocking.length === 1 ? "foi usado" : "foram usados"} desde a importação (negócio, tarefa, conversa de WhatsApp, campanha ou processo) — desfazer foi bloqueado pra não apagar trabalho feito: ${blocking
            .slice(0, 5)
            .map((c) => c.name)
            .join(", ")}${blocking.length > 5 ? "…" : ""}`,
        },
        { status: 409 },
      );
    }

    const contactIds = contacts.map((c) => c.id);

    await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, access.organizationId);
      if (contactIds.length > 0) await tx.contact.deleteMany({ where: { id: { in: contactIds } } });
      await tx.importBatch.update({ where: { id }, data: { deletedAt: new Date() } });
    });

    return NextResponse.json({ ok: true, contactsDeleted: contactIds.length });
  });
}
