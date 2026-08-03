import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { getBrazilParts } from "@/lib/timezone";
import { countActiveSellers } from "@/lib/goals/suggestion";

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
    // Sempre grava quantos vendedores ativos existem AGORA junto do valor —
    // é o que permite comparar depois "a equipe mudou desde que essa meta
    // foi salva?" sem confundir com "o valor não bate com a fórmula porque
    // foi ajustado de propósito" (ver lib/goals/suggestion.ts).
    const sellerCount = await countActiveSellers(access.organizationId);

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
        basedOnSellerCount: sellerCount,
      },
      update: {
        value,
        updatedById: access.userId,
        basedOnSellerCount: sellerCount,
      },
    });

    return NextResponse.json({ id: goal.id, value: Number(goal.value) });
  });
}
