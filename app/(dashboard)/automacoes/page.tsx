import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { AutomationsTable } from "./automations-table";

export default async function AutomacoesPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const isManager = session!.user.role === "OWNER" || session!.user.role === "MANAGER";

  return runWithTenant(organizationId, async () => {
    const [rulesRaw, pipelines, lossReasons, membersRaw, connectedInstances, customFields] = await Promise.all([
      prisma.automationRule.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.pipeline.findMany({
        where: { organizationId },
        orderBy: { order: "asc" },
        include: { stages: { orderBy: { order: "asc" }, select: { id: true, name: true } } },
      }),
      prisma.lossReason.findMany({
        where: { organizationId },
        orderBy: { order: "asc" },
        select: { id: true, label: true },
      }),
      prisma.organizationUser.findMany({
        where: { organizationId, active: true },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, name: true } } },
      }),
      // Instâncias com WhatsApp conectado — usadas no campo "Enviar de"
      prisma.whatsAppInstance.findMany({
        where: { organizationId, status: "CONNECTED" },
        select: { userId: true, phoneNumber: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.customFieldDefinition.findMany({
        where: { organizationId },
        orderBy: [{ entityType: "asc" }, { order: "asc" }],
        select: { id: true, entityType: true, label: true, type: true, options: true },
      }),
    ]);

    const rules = rulesRaw.map((r) => ({
      ...r,
      triggerConfig: r.triggerConfig as Record<string, unknown> | null,
      actionConfig: r.actionConfig as Record<string, unknown> | null,
      lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));

    const memberUserMap = new Map(membersRaw.map((m) => [m.user.id, m.user.name]));
    const whatsappInstances = connectedInstances.map((inst) => ({
      userId: inst.userId,
      label: `${memberUserMap.get(inst.userId) ?? "Usuário"} (${inst.phoneNumber ?? "sem número"})`,
    }));

    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Automações</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Regras simples que economizam horas do time</p>
        </div>
        <AutomationsTable
          initialRules={rules}
          canManage={isManager}
          pipelines={pipelines.map((p) => ({ id: p.id, name: p.name, stages: p.stages }))}
          lossReasons={lossReasons}
          members={membersRaw.map((m) => ({ id: m.user.id, name: m.user.name, role: m.role }))}
          whatsappInstances={whatsappInstances}
          customFields={customFields}
        />
      </div>
    );
  });
}
