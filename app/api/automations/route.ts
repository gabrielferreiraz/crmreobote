import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { VALID_TRIGGERS, VALID_ACTIONS, validateTriggerConfig, validateActionConfig } from "@/lib/automations/validation";
import type { $Enums, Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireRole(["OWNER", "MANAGER"]);
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

  const access = await requireRole(["OWNER", "MANAGER"]);
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

  return runWithTenant(access.organizationId, async () => {
    const triggerError = await validateTriggerConfig(
      access.organizationId,
      trigger as $Enums.AutomationTrigger,
      triggerConfig,
    );
    if (triggerError) return NextResponse.json({ error: triggerError }, { status: 400 });

    const actionError = await validateActionConfig(
      access.organizationId,
      action as $Enums.AutomationAction,
      actionConfig,
    );
    if (actionError) return NextResponse.json({ error: actionError }, { status: 400 });

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
