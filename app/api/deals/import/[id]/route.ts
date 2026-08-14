import { NextResponse } from "next/server";
import { prisma, prismaRaw } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/** Detalhe de um lote — usado pelo "ver detalhes" do histórico (linhas que não viraram negócio, com o motivo de cada uma). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const batch = await prisma.importBatch.findFirst({
      where: { id, organizationId: access.organizationId },
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
 * Desfaz uma importação — só quando é seguro: nenhum negócio criado por ela
 * pode ter sido movido, ganho/perdido, ou já ter alguma atividade/tarefa
 * registrada (mover de etapa já grava uma Activity SYSTEM automaticamente,
 * ver comentário do enum ActivityType — então "tem Activity" já cobre
 * "alguém mexeu nisso", não só atividade manual). Se algum negócio do lote
 * já foi tocado, a operação inteira é recusada (nada é apagado pela
 * metade) com uma mensagem dizendo quais negócios estão travando.
 *
 * O contato criado pela importação só é apagado junto se, depois de tirar
 * os negócios deste lote, ele não sobrar com absolutamente nada (outro
 * negócio, conversa de WhatsApp, tarefa, atividade, processo) — um contato
 * reaproveitado por outra coisa nesse meio tempo nunca é tocado.
 *
 * O registro do ImportBatch em si NUNCA é apagado (só marcado deletedAt) —
 * é o próprio rastro de auditoria que essa importação existiu e foi
 * desfeita, apagar ele apagaria essa informação junto.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const batch = await prisma.importBatch.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!batch) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    if (batch.deletedAt) return NextResponse.json({ error: "Essa importação já foi desfeita" }, { status: 409 });

    const deals = await prisma.deal.findMany({
      where: { organizationId: access.organizationId, importBatchId: id },
      select: { id: true, name: true, status: true, _count: { select: { activities: true, tasks: true } } },
    });

    const blocking = deals.filter((d) => d.status !== "OPEN" || d._count.activities > 0 || d._count.tasks > 0);
    if (blocking.length > 0) {
      return NextResponse.json(
        {
          error: `${blocking.length} negócio${blocking.length === 1 ? "" : "s"} já ${blocking.length === 1 ? "foi alterado" : "foram alterados"} desde a importação (movido, ganho/perdido, ou já tem atividade/tarefa registrada) — desfazer foi bloqueado pra não apagar trabalho feito: ${blocking
            .slice(0, 5)
            .map((d) => d.name)
            .join(", ")}${blocking.length > 5 ? "…" : ""}`,
        },
        { status: 409 },
      );
    }

    const dealIds = deals.map((d) => d.id);
    const contacts = await prisma.contact.findMany({
      where: { organizationId: access.organizationId, importBatchId: id },
      select: { id: true },
    });
    const contactIds = contacts.map((c) => c.id);

    await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, access.organizationId);

      if (dealIds.length > 0) await tx.deal.deleteMany({ where: { id: { in: dealIds } } });

      if (contactIds.length > 0) {
        // Roda DEPOIS do deleteMany de negócios acima — "deals: { some: {} }"
        // só enxerga negócio de FORA deste lote a essa altura, já que os
        // deste lote acabaram de sumir.
        const stillLinked = await tx.contact.findMany({
          where: {
            id: { in: contactIds },
            OR: [
              { deals: { some: {} } },
              { tasks: { some: {} } },
              { activities: { some: {} } },
              { whatsappThreads: { some: {} } },
              { campaignRecipients: { some: {} } },
              { processes: { some: {} } },
            ],
          },
          select: { id: true },
        });
        const stillLinkedIds = new Set(stillLinked.map((c) => c.id));
        const cleanContactIds = contactIds.filter((cid) => !stillLinkedIds.has(cid));
        if (cleanContactIds.length > 0) await tx.contact.deleteMany({ where: { id: { in: cleanContactIds } } });
      }

      await tx.importBatch.update({ where: { id }, data: { deletedAt: new Date() } });
    });

    return NextResponse.json({ ok: true, dealsDeleted: dealIds.length });
  });
}
