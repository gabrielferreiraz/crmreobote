import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { getBrazilParts } from "@/lib/timezone";

export const dynamic = "force-dynamic";

/** Define (cria ou atualiza) a meta do mês corrente — só Dono. */
export async function PUT(req: Request) {
  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { value } = body as { value?: number };

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return NextResponse.json({ error: "Valor de meta inválido" }, { status: 400 });
  }

  const { year, month } = getBrazilParts(new Date());

  return runWithTenant(access.organizationId, async () => {
    const goal = await prisma.monthlyGoal.upsert({
      where: {
        organizationId_year_month: { organizationId: access.organizationId, year, month: month + 1 },
      },
      create: {
        organizationId: access.organizationId,
        year,
        month: month + 1,
        value,
        updatedById: access.userId,
      },
      update: {
        value,
        updatedById: access.userId,
      },
    });

    return NextResponse.json({ id: goal.id, value: Number(goal.value) });
  });
}
