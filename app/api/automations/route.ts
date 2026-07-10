import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import type { $Enums, Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

const VALID_TRIGGERS: $Enums.AutomationTrigger[] = [
  "DEAL_STALE",
  "DEAL_CREATED",
  "DEAL_WON",
  "DEAL_LOST",
  "TASK_OVERDUE",
  "DEAL_STAGE_ENTERED",
  "DEAL_NO_OPEN_TASK",
  "CONTACT_NO_DEAL",
  "SCHEDULED",
];

const VALID_ACTIONS: $Enums.AutomationAction[] = [
  "CREATE_TASK",
  "ADD_NOTE",
  "MARK_LOST",
  "SEND_PUSH",
  "SEND_WHATSAPP",
];

export async function GET() {
  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const rules = await prisma.automationRule.findMany({
      where: { organizationId: access.organizationId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(rules);
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name, trigger, triggerConfig, action, actionConfig } = body as {
    name?: string;
    trigger?: string;
    triggerConfig?: Record<string, unknown>;
    action?: string;
    actionConfig?: Record<string, unknown>;
  };

  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!name || !trigger || !action) {
    return NextResponse.json({ error: "name, trigger e action são obrigatórios" }, { status: 400 });
  }
  if (!VALID_TRIGGERS.includes(trigger as $Enums.AutomationTrigger)) {
    return NextResponse.json({ error: "Gatilho inválido" }, { status: 400 });
  }
  if (!VALID_ACTIONS.includes(action as $Enums.AutomationAction)) {
    return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  }
  if (trigger === "DEAL_STAGE_ENTERED" && !(triggerConfig?.stageId as string | undefined)) {
    return NextResponse.json({ error: "Selecione a etapa que dispara a automação" }, { status: 400 });
  }
  if (trigger === "SCHEDULED") {
    const config = triggerConfig as { frequency?: string; time?: string; assigneeId?: string } | undefined;
    if (!config?.frequency || !config?.time || !config?.assigneeId) {
      return NextResponse.json(
        { error: "Preencha a frequência, o horário e o responsável do agendamento" },
        { status: 400 },
      );
    }
  }
  if (action === "MARK_LOST" && !(actionConfig?.lossReasonId as string | undefined)) {
    return NextResponse.json({ error: "Selecione o motivo de perda" }, { status: 400 });
  }
  if (action === "SEND_WHATSAPP" && !(actionConfig?.whatsappMessage as string | undefined)?.trim()) {
    return NextResponse.json({ error: "Escreva o texto da mensagem de WhatsApp" }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    if (trigger === "DEAL_STAGE_ENTERED") {
      const stageId = triggerConfig!.stageId as string;
      const stage = await prisma.pipelineStage.findFirst({
        where: { id: stageId, pipeline: { organizationId: access.organizationId } },
      });
      if (!stage) return NextResponse.json({ error: "Etapa inválida" }, { status: 400 });
    }
    if (trigger === "SCHEDULED") {
      const assigneeId = (triggerConfig as { assigneeId: string }).assigneeId;
      const member = await prisma.organizationUser.findFirst({
        where: { organizationId: access.organizationId, userId: assigneeId, active: true },
      });
      if (!member) return NextResponse.json({ error: "Responsável inválido" }, { status: 400 });
    }
    if (action === "MARK_LOST") {
      const lossReasonId = actionConfig!.lossReasonId as string;
      const reason = await prisma.lossReason.findFirst({
        where: { id: lossReasonId, organizationId: access.organizationId },
      });
      if (!reason) return NextResponse.json({ error: "Motivo de perda inválido" }, { status: 400 });
    }

    const rule = await prisma.automationRule.create({
      data: {
        organizationId: access.organizationId,
        name,
        trigger: trigger as $Enums.AutomationTrigger,
        triggerConfig: (triggerConfig ?? undefined) as Prisma.InputJsonValue | undefined,
        action: action as $Enums.AutomationAction,
        actionConfig: (actionConfig ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    return NextResponse.json(rule, { status: 201 });
  });
}
