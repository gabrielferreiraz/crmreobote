import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { VALID_TRIGGERS, VALID_ACTIONS, validateTriggerConfig, validateActionConfig } from "@/lib/automations/validation";
import type { $Enums, Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, enabled, trigger, triggerConfig, action, actionConfig } = body as {
    name?: string;
    enabled?: boolean;
    trigger?: string;
    triggerConfig?: Record<string, unknown>;
    action?: string;
    actionConfig?: Record<string, unknown>;
  };

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

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
    const existing = await prisma.automationRule.findFirst({
      where: { id, organizationId: access.organizationId },
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

    const rule = await prisma.automationRule.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
        ...(trigger !== undefined ? { trigger: trigger as $Enums.AutomationTrigger } : {}),
        ...(triggerConfig !== undefined ? { triggerConfig: triggerConfig as Prisma.InputJsonValue } : {}),
        ...(action !== undefined ? { action: action as $Enums.AutomationAction } : {}),
        ...(actionConfig !== undefined ? { actionConfig: actionConfig as Prisma.InputJsonValue } : {}),
      },
    });

    return NextResponse.json(rule);
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.automationRule.findFirst({
      where: { id, organizationId: access.organizationId },
    });
    if (!existing) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

    await prisma.automationRule.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
