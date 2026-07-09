import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import type { $Enums } from "@/app/generated/prisma/client";
import { STALE_DEAL_DAYS } from "@/lib/stale";
import { runWithTenant } from "@/lib/tenant-context";

type TriggerConfig = { days?: number; stageId?: string; minHours?: number };
type ActionConfig = { title?: string; dueInDays?: number; note?: string; lossReasonId?: string };

type Entity = {
  entityId: string;
  organizationId: string;
  dealId?: string;
  contactId?: string;
  ownerId: string;
};

type RuleWithOrg = {
  id: string;
  organizationId: string;
  name: string;
  trigger: $Enums.AutomationTrigger;
  triggerConfig: Prisma.JsonValue;
  action: $Enums.AutomationAction;
  actionConfig: Prisma.JsonValue;
  createdAt: Date;
};

async function filterUnexecuted(ruleId: string, candidateIds: string[]): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();
  const executed = await prisma.automationExecution.findMany({
    where: { ruleId, entityId: { in: candidateIds } },
    select: { entityId: true },
  });
  const executedSet = new Set(executed.map((e) => e.entityId));
  return new Set(candidateIds.filter((id) => !executedSet.has(id)));
}

async function recordExecution(ruleId: string, entityId: string): Promise<boolean> {
  try {
    await prisma.automationExecution.create({ data: { ruleId, entityId } });
    return true;
  } catch (err) {
    // P2002: outra execução concorrente já registrou esse par (ruleId, entityId) primeiro.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    throw err;
  }
}

async function performAction(rule: RuleWithOrg, entity: Entity) {
  const actionConfig = (rule.actionConfig ?? {}) as ActionConfig;

  if (rule.action === "CREATE_TASK") {
    const dueInDays = actionConfig.dueInDays ?? 1;
    await prisma.task.create({
      data: {
        organizationId: entity.organizationId,
        dealId: entity.dealId,
        contactId: entity.contactId,
        ownerId: entity.ownerId,
        type: "OTHER",
        title: actionConfig.title?.trim() || `Automação: ${rule.name}`,
        dueAt: new Date(Date.now() + dueInDays * 24 * 60 * 60 * 1000),
      },
    });
    return;
  }

  if (rule.action === "ADD_NOTE") {
    await prisma.activity.create({
      data: {
        organizationId: entity.organizationId,
        dealId: entity.dealId,
        contactId: entity.contactId,
        userId: entity.ownerId,
        type: "NOTE",
        body: `[Automação: ${rule.name}] ${actionConfig.note?.trim() || ""}`.trim(),
      },
    });
    return;
  }

  if (rule.action === "MARK_LOST") {
    if (!entity.dealId || !actionConfig.lossReasonId) return;
    const updated = await prisma.deal.updateMany({
      where: { id: entity.dealId, organizationId: entity.organizationId, status: "OPEN" },
      data: { status: "LOST", closedAt: new Date(), lossReasonId: actionConfig.lossReasonId },
    });
    if (updated.count > 0) {
      await prisma.activity.create({
        data: {
          organizationId: entity.organizationId,
          dealId: entity.dealId,
          contactId: entity.contactId,
          userId: entity.ownerId,
          type: "NOTE",
          body: `[Automação: ${rule.name}] Negócio marcado como perdido automaticamente.`,
        },
      });
    }
    return;
  }
}

async function findMatches(rule: RuleWithOrg): Promise<Entity[]> {
  const triggerConfig = (rule.triggerConfig ?? {}) as TriggerConfig;

  if (rule.trigger === "DEAL_STALE") {
    const days = triggerConfig.days ?? STALE_DEAL_DAYS;
    const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const deals = await prisma.deal.findMany({
      where: { organizationId: rule.organizationId, status: "OPEN", stageEnteredAt: { lte: threshold } },
      select: { id: true, contactId: true, ownerId: true },
    });
    const pending = await filterUnexecuted(rule.id, deals.map((d) => d.id));
    return deals
      .filter((d) => pending.has(d.id))
      .map((d) => ({
        entityId: d.id,
        organizationId: rule.organizationId,
        dealId: d.id,
        contactId: d.contactId,
        ownerId: d.ownerId,
      }));
  }

  if (rule.trigger === "DEAL_CREATED") {
    const deals = await prisma.deal.findMany({
      where: { organizationId: rule.organizationId, createdAt: { gte: rule.createdAt } },
      select: { id: true, contactId: true, ownerId: true },
    });
    const pending = await filterUnexecuted(rule.id, deals.map((d) => d.id));
    return deals
      .filter((d) => pending.has(d.id))
      .map((d) => ({
        entityId: d.id,
        organizationId: rule.organizationId,
        dealId: d.id,
        contactId: d.contactId,
        ownerId: d.ownerId,
      }));
  }

  if (rule.trigger === "DEAL_WON" || rule.trigger === "DEAL_LOST") {
    const status = rule.trigger === "DEAL_WON" ? "WON" : "LOST";
    const deals = await prisma.deal.findMany({
      where: { organizationId: rule.organizationId, status, closedAt: { gte: rule.createdAt } },
      select: { id: true, contactId: true, ownerId: true },
    });
    const pending = await filterUnexecuted(rule.id, deals.map((d) => d.id));
    return deals
      .filter((d) => pending.has(d.id))
      .map((d) => ({
        entityId: d.id,
        organizationId: rule.organizationId,
        dealId: d.id,
        contactId: d.contactId,
        ownerId: d.ownerId,
      }));
  }

  if (rule.trigger === "TASK_OVERDUE") {
    const tasks = await prisma.task.findMany({
      where: { organizationId: rule.organizationId, completedAt: null, dueAt: { lte: new Date() } },
      select: { id: true, dealId: true, contactId: true, ownerId: true },
    });
    const pending = await filterUnexecuted(rule.id, tasks.map((t) => t.id));
    return tasks
      .filter((t) => pending.has(t.id))
      .map((t) => ({
        entityId: t.id,
        organizationId: rule.organizationId,
        dealId: t.dealId ?? undefined,
        contactId: t.contactId ?? undefined,
        ownerId: t.ownerId,
      }));
  }

  if (rule.trigger === "DEAL_STAGE_ENTERED") {
    const stageId = triggerConfig.stageId;
    if (!stageId) return [];
    const deals = await prisma.deal.findMany({
      where: { organizationId: rule.organizationId, stageId, stageEnteredAt: { gte: rule.createdAt } },
      select: { id: true, contactId: true, ownerId: true, stageEnteredAt: true },
    });
    // A entidade inclui o timestamp de entrada na etapa para permitir que a
    // mesma regra dispare de novo se o negócio sair e voltar a essa etapa.
    const keyed = deals.map((d) => ({ ...d, key: `${d.id}:${d.stageEnteredAt.getTime()}` }));
    const pending = await filterUnexecuted(rule.id, keyed.map((d) => d.key));
    return keyed
      .filter((d) => pending.has(d.key))
      .map((d) => ({
        entityId: d.key,
        organizationId: rule.organizationId,
        dealId: d.id,
        contactId: d.contactId,
        ownerId: d.ownerId,
      }));
  }

  if (rule.trigger === "DEAL_NO_OPEN_TASK") {
    const minHours = triggerConfig.minHours ?? 24;
    const threshold = new Date(Date.now() - minHours * 60 * 60 * 1000);
    const deals = await prisma.deal.findMany({
      where: {
        organizationId: rule.organizationId,
        status: "OPEN",
        createdAt: { lte: threshold },
        tasks: { none: { completedAt: null } },
      },
      select: { id: true, contactId: true, ownerId: true },
    });
    const pending = await filterUnexecuted(rule.id, deals.map((d) => d.id));
    return deals
      .filter((d) => pending.has(d.id))
      .map((d) => ({
        entityId: d.id,
        organizationId: rule.organizationId,
        dealId: d.id,
        contactId: d.contactId,
        ownerId: d.ownerId,
      }));
  }

  if (rule.trigger === "CONTACT_NO_DEAL") {
    const days = triggerConfig.days ?? 2;
    const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const contacts = await prisma.contact.findMany({
      where: { organizationId: rule.organizationId, createdAt: { lte: threshold }, deals: { none: {} } },
      select: { id: true },
    });
    const pending = await filterUnexecuted(rule.id, contacts.map((c) => c.id));
    const candidates = contacts.filter((c) => pending.has(c.id));
    if (candidates.length === 0) return [];

    const members = await prisma.organizationUser.findMany({
      where: { organizationId: rule.organizationId, active: true },
      orderBy: { createdAt: "asc" },
      select: { userId: true },
    });
    if (members.length === 0) return [];

    const loads = await prisma.deal.groupBy({
      by: ["ownerId"],
      where: { organizationId: rule.organizationId, status: "OPEN" },
      _count: true,
    });
    const loadByUser = new Map(loads.map((l) => [l.ownerId, l._count]));

    return candidates.map((c) => {
      let picked = members[0].userId;
      let lowest = loadByUser.get(picked) ?? 0;
      for (const member of members) {
        const count = loadByUser.get(member.userId) ?? 0;
        if (count < lowest) {
          lowest = count;
          picked = member.userId;
        }
      }
      loadByUser.set(picked, (loadByUser.get(picked) ?? 0) + 1);
      return { entityId: c.id, organizationId: rule.organizationId, contactId: c.id, ownerId: picked };
    });
  }

  return [];
}

async function runRule(rule: RuleWithOrg): Promise<number> {
  const matches = await findMatches(rule);

  let fired = 0;
  for (const entity of matches) {
    const recorded = await recordExecution(rule.id, entity.entityId);
    if (!recorded) continue;
    await performAction(rule, entity);
    fired += 1;
  }
  return fired;
}

export async function runAutomations(): Promise<{ rulesEvaluated: number; actionsFired: number }> {
  // Organization não é uma tabela com RLS (é a própria organização, não tem
  // organizationId) — listar todas aqui é seguro sem tenant context. As regras
  // de cada uma são buscadas depois, já com o tenant daquela organização
  // definido, pra respeitar o RLS normalmente.
  const organizations = await prisma.organization.findMany({ select: { id: true } });

  let rulesEvaluated = 0;
  let actionsFired = 0;

  for (const org of organizations) {
    const orgResult = await runWithTenant(org.id, async () => {
      const rules = await prisma.automationRule.findMany({ where: { enabled: true } });

      let fired = 0;
      for (const rule of rules) {
        const ruleFired = await runRule(rule);
        fired += ruleFired;
        if (ruleFired > 0) {
          await prisma.automationRule.update({
            where: { id: rule.id },
            data: { runCount: { increment: ruleFired }, lastRunAt: new Date() },
          });
        }
      }

      return { rulesEvaluated: rules.length, actionsFired: fired };
    });

    rulesEvaluated += orgResult.rulesEvaluated;
    actionsFired += orgResult.actionsFired;
  }

  return { rulesEvaluated, actionsFired };
}
