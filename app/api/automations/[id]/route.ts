import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { VALID_TRIGGERS, VALID_ACTIONS, validateTriggerConfig, validateActionConfig, resolveTargetConfig } from "@/lib/automations/validation";
import type { $Enums, Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, enabled, trigger, triggerConfig, action, actionConfig, targetType, targetUserIds, targetTeamId } = body as {
    name?: string;
    enabled?: boolean;
    trigger?: string;
    triggerConfig?: Record<string, unknown>;
    action?: string;
    actionConfig?: Record<string, unknown>;
    targetType?: string;
    targetUserIds?: string[];
    targetTeamId?: string | null;
  };

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const isManager = access.role === "OWNER" || access.role === "MANAGER";

  // trigger/action só vêm preenchidos na edição completa (modal de editar,
  // que sempre manda os dois junto com seus configs); o toggle de
  // pausar/ativar manda só { enabled } e pula toda essa validação.
  if (trigger !== undefined && !VALID_TRIGGERS.includes(trigger as $Enums.AutomationTrigger)) {
    return NextResponse.json({ error: "Gatilho inválido" }, { status: 400 });
  }
  if (action !== undefined && !VALID_ACTIONS.includes(action as $Enums.AutomationAction)) {
    return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    // Supervisor/Consultor só edita a própria regra — embutido no próprio
    // lookup (não numa checagem separada depois) pra um id de regra alheia
    // simplesmente não ser encontrado, igual a qualquer outro recurso
    // escopado por dono neste CRM.
    const existing = await prisma.automationRule.findFirst({
      where: { id, organizationId: access.organizationId, ...(isManager ? {} : { createdById: access.userId }) },
    });
    if (!existing) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

    if (trigger !== undefined) {
      const triggerError = await validateTriggerConfig(
        access.organizationId,
        trigger as $Enums.AutomationTrigger,
        triggerConfig,
      );
      if (triggerError) return NextResponse.json({ error: triggerError }, { status: 400 });
    }
    if (action !== undefined) {
      const actionError = await validateActionConfig(
        access.organizationId,
        action as $Enums.AutomationAction,
        actionConfig,
      );
      if (actionError) return NextResponse.json({ error: actionError }, { status: 400 });
    }

    // Só recalcula o alvo quando a edição completa manda targetType (o
    // toggle de pausar/ativar manda só { enabled } e não deve mexer nisso).
    // isManager aqui é de quem está EDITANDO agora, não de quem criou —
    // um Gerente pode reconfigurar o alvo de uma regra que um Consultor
    // criou; se o próprio Consultor editar a regra dele mais tarde, o alvo
    // é sempre forçado de volta pra SELF, nunca confia no que o cliente manda.
    let targetData = {};
    if (targetType !== undefined) {
      const targetResult = await resolveTargetConfig(access.organizationId, isManager, {
        targetType,
        targetUserIds,
        targetTeamId,
      });
      if (!targetResult.ok) return NextResponse.json({ error: targetResult.error }, { status: 400 });
      targetData = targetResult.value;
    }

    const rule = await prisma.automationRule.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
        ...(trigger !== undefined ? { trigger: trigger as $Enums.AutomationTrigger } : {}),
        ...(triggerConfig !== undefined ? { triggerConfig: triggerConfig as Prisma.InputJsonValue } : {}),
        ...(action !== undefined ? { action: action as $Enums.AutomationAction } : {}),
        ...(actionConfig !== undefined ? { actionConfig: actionConfig as Prisma.InputJsonValue } : {}),
        ...targetData,
      },
    });

    return NextResponse.json(rule);
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const isManager = access.role === "OWNER" || access.role === "MANAGER";

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.automationRule.findFirst({
      where: { id, organizationId: access.organizationId, ...(isManager ? {} : { createdById: access.userId }) },
    });
    if (!existing) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

    await prisma.automationRule.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
