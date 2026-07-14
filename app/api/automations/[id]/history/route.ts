import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { getAutomationHistory } from "@/lib/automations/history";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const rule = await prisma.automationRule.findFirst({
      where: { id, organizationId: access.organizationId },
      select: { id: true, trigger: true },
    });
    if (!rule) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

    const history = await getAutomationHistory(access.organizationId, rule);
    return NextResponse.json(history);
  });
}
