/**
 * Histórico de execuções de uma automação — AutomationExecution só guarda
 * `entityId` cru (a chave usada pra deduplicar disparo repetido, ver
 * filterUnexecuted em lib/automations/engine.ts), cujo significado depende
 * do gatilho da regra: id de negócio, de tarefa, de contato, um composto
 * "dealId:timestamp" (DEAL_STAGE_ENTERED) ou um slot de horário sem
 * entidade nenhuma (SCHEDULED). Resolve tudo isso pra um rótulo legível.
 */

import { prisma } from "@/lib/prisma";
import type { $Enums } from "@/app/generated/prisma/client";

export type AutomationHistoryEntry = {
  id: string;
  executedAt: Date;
  label: string;
  href: string | null;
};

const EXECUTION_LIMIT = 50;

function formatScheduledOccurrence(entityId: string): string {
  // "2026-07-13T08" → "13/07/2026 às 08h"
  const [dateKey, hour] = entityId.split("T");
  const [year, month, day] = dateKey.split("-");
  if (!year || !month || !day || !hour) return entityId;
  return `${day}/${month}/${year} às ${hour}h`;
}

export async function getAutomationHistory(
  organizationId: string,
  rule: { id: string; trigger: $Enums.AutomationTrigger },
): Promise<AutomationHistoryEntry[]> {
  const executions = await prisma.automationExecution.findMany({
    where: { ruleId: rule.id },
    orderBy: { createdAt: "desc" },
    take: EXECUTION_LIMIT,
    select: { id: true, entityId: true, createdAt: true },
  });
  if (executions.length === 0) return [];

  if (rule.trigger === "SCHEDULED") {
    return executions.map((e) => ({
      id: e.id,
      executedAt: e.createdAt,
      label: `Disparo agendado — ${formatScheduledOccurrence(e.entityId)}`,
      href: null,
    }));
  }

  if (rule.trigger === "TASK_OVERDUE" || rule.trigger === "TASK_DUE_SOON") {
    const tasks = await prisma.task.findMany({
      where: { id: { in: executions.map((e) => e.entityId) }, organizationId },
      select: { id: true, title: true, dealId: true },
    });
    const byId = new Map(tasks.map((t) => [t.id, t]));
    return executions.map((e) => {
      const t = byId.get(e.entityId);
      return {
        id: e.id,
        executedAt: e.createdAt,
        label: t ? `Tarefa: ${t.title}` : "Tarefa removida",
        href: t?.dealId ? `/negocios/${t.dealId}` : null,
      };
    });
  }

  if (rule.trigger === "CONTACT_NO_DEAL") {
    const contacts = await prisma.contact.findMany({
      where: { id: { in: executions.map((e) => e.entityId) }, organizationId },
      select: { id: true, name: true },
    });
    const byId = new Map(contacts.map((c) => [c.id, c]));
    return executions.map((e) => {
      const c = byId.get(e.entityId);
      return {
        id: e.id,
        executedAt: e.createdAt,
        label: c ? `Contato: ${c.name}` : "Contato removido",
        href: c ? `/clientes/${e.entityId}` : null,
      };
    });
  }

  // DEAL_STALE/DEAL_CREATED/DEAL_WON/DEAL_LOST/DEAL_NO_OPEN_TASK: entityId = dealId puro.
  // DEAL_STAGE_ENTERED: entityId = "dealId:stageEnteredAtMs" (composto, permite disparar
  // de novo se o negócio sair e voltar à mesma etapa — ver findMatches no engine).
  const dealIdOf = (entityId: string) => (rule.trigger === "DEAL_STAGE_ENTERED" ? entityId.split(":")[0] : entityId);
  const deals = await prisma.deal.findMany({
    where: { id: { in: executions.map((e) => dealIdOf(e.entityId)) }, organizationId },
    select: { id: true, name: true },
  });
  const dealById = new Map(deals.map((d) => [d.id, d]));
  return executions.map((e) => {
    const dealId = dealIdOf(e.entityId);
    const d = dealById.get(dealId);
    return {
      id: e.id,
      executedAt: e.createdAt,
      label: d ? `Negócio: ${d.name}` : "Negócio removido",
      href: d ? `/negocios/${dealId}` : null,
    };
  });
}
