import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import type { Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, enabled, triggerConfig, actionConfig } = body as {
    name?: string;
    enabled?: boolean;
    triggerConfig?: Record<string, unknown>;
    actionConfig?: Record<string, unknown>;
  };

  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.automationRule.findFirst({
      where: { id, organizationId: access.organizationId },
    });
    if (!existing) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

    const rule = await prisma.automationRule.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
        ...(triggerConfig !== undefined ? { triggerConfig: triggerConfig as Prisma.InputJsonValue } : {}),
        ...(actionConfig !== undefined ? { actionConfig: actionConfig as Prisma.InputJsonValue } : {}),
      },
    });

    return NextResponse.json(rule);
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "ADMIN"]);
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
