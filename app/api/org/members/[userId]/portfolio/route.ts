import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope, type DealScope } from "@/lib/team-scope";
import { recordUndoableAction } from "@/lib/undo/record";
import type { BulkUpdateGroup, BulkUpdatePayload } from "@/lib/undo/types";
import { logAudit } from "@/lib/audit-log";
import { recordUserChange } from "@/lib/user-activity";

export const dynamic = "force-dynamic";

/**
 * Passar a carteira de um consultor pra outro — pensado pro consultor que
 * saiu (ver Equipes → "Passar carteira de clientes", app/(dashboard)/
 * configuracoes/equipes/portfolio-transfer-manager.tsx). Pedido explícito do
 * Dono:
 * - Só OWNER/MANAGER/SUPERVISOR fazem essa ação (nunca o próprio consultor).
 * - Supervisor só mexe em gente da própria equipe — reaproveita
 *   getDealScope, a MESMA regra que já restringe o que ele enxerga no
 *   Pipeline, tanto pra quem sai (fromUserId, na URL) quanto pra quem
 *   recebe (toUserId, no corpo).
 * - Selecionar só cliente NÃO mexe no negócio (Contact.responsavelId muda,
 *   Deal.ownerId não); selecionar negócio EXIGE o próprio cliente junto (o
 *   servidor derruba silenciosamente qualquer negócio cujo cliente não
 *   veio selecionado — a tela já impede isso, mas não confia só nela).
 * - Tarefa/andamento presos a um negócio transferido mudam de dono junto;
 *   os que estão soltos (sem negócio) mudam junto com o CLIENTE. Os que
 *   ficam presos a um negócio que NÃO foi selecionado continuam como
 *   estavam — o cliente muda de responsável, aquele negócio específico não.
 */

function canActOn(scope: DealScope, id: string) {
  return scope.type === "all" || scope.ownerIds.includes(id);
}

export async function GET(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId: fromUserId } = await params;
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { organizationId, userId, role } = access;

  return runWithTenant(organizationId, async () => {
    const scope = await getDealScope(organizationId, userId, role);
    if (!canActOn(scope, fromUserId)) {
      return NextResponse.json({ error: "Você não pode ver a carteira desta pessoa" }, { status: 403 });
    }

    const [contacts, deals] = await Promise.all([
      prisma.contact.findMany({
        where: { organizationId, responsavelId: fromUserId },
        select: { id: true, name: true, phone: true, whatsapp: true },
        orderBy: { name: "asc" },
      }),
      // Só negócio EM ANDAMENTO entra na transferência — ganho/perdido é
      // histórico fechado, mudar o dono dali só bagunçaria comissão/relatório
      // de uma venda que já acabou, sem servir ao motivo real (o novo
      // consultor seguir a negociação na Pipeline dele).
      prisma.deal.findMany({
        where: { organizationId, ownerId: fromUserId, status: "OPEN" },
        select: {
          id: true,
          name: true,
          value: true,
          contactId: true,
          stage: { select: { name: true } },
          pipeline: { select: { name: true } },
        },
        orderBy: { startedAt: "desc" },
      }),
    ]);

    return NextResponse.json({
      contacts,
      deals: deals.map((d) => ({
        id: d.id,
        name: d.name,
        value: d.value,
        contactId: d.contactId,
        stageName: d.stage.name,
        pipelineName: d.pipeline.name,
      })),
    });
  });
}

type TransferBody = { toUserId?: string; contactIds?: string[]; dealIds?: string[] };

/** Mesma ideia de groupByPreviousValues em app/api/deals/bulk/route.ts — agrupa por estado anterior pro desfazer custar uma consulta por estado distinto, não uma por linha. */
function groupByPreviousValues(
  model: BulkUpdateGroup["model"],
  rows: { id: string; previousValues: Record<string, unknown> }[],
): BulkUpdateGroup[] {
  const byKey = new Map<string, BulkUpdateGroup>();
  for (const row of rows) {
    const key = JSON.stringify(row.previousValues);
    const found = byKey.get(key);
    if (found) found.entityIds.push(row.id);
    else byKey.set(key, { model, previousValues: row.previousValues, entityIds: [row.id] });
  }
  return Array.from(byKey.values());
}

export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId: fromUserId } = await params;
  const body = (await req.json().catch(() => null)) as TransferBody | null;
  if (!body) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const toUserId = body.toUserId;
  const contactIds = Array.from(new Set(Array.isArray(body.contactIds) ? body.contactIds.filter((id) => typeof id === "string") : []));
  const dealIds = Array.from(new Set(Array.isArray(body.dealIds) ? body.dealIds.filter((id) => typeof id === "string") : []));

  if (!toUserId || typeof toUserId !== "string") {
    return NextResponse.json({ error: "Selecione para quem vai a carteira" }, { status: 400 });
  }
  if (toUserId === fromUserId) {
    return NextResponse.json({ error: "Escolha alguém diferente do próprio consultor" }, { status: 400 });
  }
  if (contactIds.length === 0) {
    return NextResponse.json({ error: "Selecione ao menos um cliente" }, { status: 400 });
  }

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { organizationId, userId, role } = access;

  return runWithTenant(organizationId, async () => {
    const scope = await getDealScope(organizationId, userId, role);
    if (!canActOn(scope, fromUserId) || !canActOn(scope, toUserId)) {
      return NextResponse.json({ error: "Você não pode transferir carteira entre essas pessoas" }, { status: 403 });
    }

    const [toMembership, fromUser, toUser, contacts] = await Promise.all([
      prisma.organizationUser.findFirst({ where: { organizationId, userId: toUserId, active: true }, select: { userId: true } }),
      prisma.user.findUnique({ where: { id: fromUserId }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: toUserId }, select: { name: true } }),
      prisma.contact.findMany({
        where: { organizationId, responsavelId: fromUserId, id: { in: contactIds } },
        select: { id: true, responsavelId: true },
      }),
    ]);
    if (!toMembership) return NextResponse.json({ error: "Destinatário inválido" }, { status: 400 });
    if (contacts.length === 0) return NextResponse.json({ error: "Nenhum cliente encontrado para transferir" }, { status: 404 });

    const validContactIds = contacts.map((c) => c.id);

    const dealsRequested =
      dealIds.length > 0
        ? await prisma.deal.findMany({
            where: { organizationId, ownerId: fromUserId, status: "OPEN", id: { in: dealIds } },
            select: { id: true, ownerId: true, contactId: true },
          })
        : [];
    const validContactIdSet = new Set(validContactIds);
    // Negócio cujo cliente não está na seleção nunca entra — a tela já
    // obriga marcar o cliente junto, isto é só o cinto de segurança do
    // servidor contra uma requisição adulterada.
    const deals = dealsRequested.filter((d) => validContactIdSet.has(d.contactId));
    const skippedDeals = dealsRequested.length - deals.length;
    const dealIdsChanged = deals.map((d) => d.id);

    await prisma.contact.updateMany({ where: { id: { in: validContactIds } }, data: { responsavelId: toUserId } });

    if (dealIdsChanged.length > 0) {
      await prisma.deal.updateMany({ where: { id: { in: dealIdsChanged } }, data: { ownerId: toUserId } });
      // Mesma regra do PUT individual e do bulkOwner: quem vira responsável
      // principal deixa de ser co-responsável.
      await prisma.dealParticipant.deleteMany({ where: { dealId: { in: dealIdsChanged }, userId: toUserId } });
    }

    // Tarefa/andamento presos a um negócio só seguem se O NEGÓCIO foi
    // selecionado; soltos (sem negócio) seguem junto com o CLIENTE.
    const tasks = await prisma.task.findMany({
      where: {
        organizationId,
        ownerId: fromUserId,
        OR: [{ dealId: { in: dealIdsChanged } }, { dealId: null, contactId: { in: validContactIds } }],
      },
      select: { id: true, ownerId: true },
    });
    if (tasks.length > 0) {
      await prisma.task.updateMany({ where: { id: { in: tasks.map((t) => t.id) } }, data: { ownerId: toUserId } });
    }

    const activities = await prisma.activity.findMany({
      where: {
        organizationId,
        userId: fromUserId,
        OR: [{ dealId: { in: dealIdsChanged } }, { dealId: null, contactId: { in: validContactIds } }],
      },
      select: { id: true, userId: true },
    });
    if (activities.length > 0) {
      await prisma.activity.updateMany({ where: { id: { in: activities.map((a) => a.id) } }, data: { userId: toUserId } });
    }

    const fromName = fromUser?.name ?? "o consultor anterior";
    const toName = toUser?.name ?? "o novo responsável";

    // Uma entrada na timeline de cada negócio transferido — pra quem abrir o
    // negócio depois entender de onde ele veio, igual às ações em massa do
    // Pipeline (ver app/api/deals/bulk/route.ts).
    if (dealIdsChanged.length > 0) {
      await prisma.activity.createMany({
        data: dealIdsChanged.map((dealId) => ({
          organizationId,
          dealId,
          userId: toUserId,
          type: "SYSTEM" as const,
          body: `carteira transferida de ${fromName} para ${toName}`,
        })),
      });
    }

    const groups = [
      ...groupByPreviousValues(
        "contact",
        contacts.map((c) => ({ id: c.id, previousValues: { responsavelId: c.responsavelId } })),
      ),
      ...groupByPreviousValues(
        "deal",
        deals.map((d) => ({ id: d.id, previousValues: { ownerId: d.ownerId } })),
      ),
      ...groupByPreviousValues(
        "task",
        tasks.map((t) => ({ id: t.id, previousValues: { ownerId: t.ownerId } })),
      ),
      ...groupByPreviousValues(
        "activity",
        activities.map((a) => ({ id: a.id, previousValues: { userId: a.userId } })),
      ),
    ];

    const original = `Carteira de ${fromName} transferida para ${toName} (${contacts.length} ${contacts.length === 1 ? "cliente" : "clientes"}${dealIdsChanged.length > 0 ? `, ${dealIdsChanged.length} ${dealIdsChanged.length === 1 ? "negócio" : "negócios"}` : ""})`;
    const undo =
      groups.length > 0
        ? await recordUndoableAction({
            organizationId,
            userId,
            type: "deal.bulkUpdate",
            description: original,
            payload: {
              groups,
              descriptions: { afterRevert: `Carteira voltou para ${fromName}`, original },
            } satisfies BulkUpdatePayload,
          })
        : undefined;

    await logAudit({
      organizationId,
      actorUserId: userId,
      actorName: access.session?.user?.name ?? "Usuário",
      action: "PORTFOLIO_TRANSFERRED",
      targetType: "User",
      targetId: fromUserId,
      targetLabel: fromName,
      detail: `${contacts.length} cliente(s) e ${dealIdsChanged.length} negócio(s) de ${fromName} para ${toName}`,
    });

    recordUserChange(organizationId, userId).catch((err) => console.error("[user-activity] falha ao registrar alteração", err));

    return NextResponse.json({
      contactsTransferred: contacts.length,
      dealsTransferred: dealIdsChanged.length,
      tasksTransferred: tasks.length,
      activitiesTransferred: activities.length,
      skippedDeals,
      undo,
    });
  });
}
