import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { requireCommissionManager, auditCommission, badRequest, parseMoney, commissionRoute } from "@/lib/commissions/route-helpers";
import { isMonthKey, formatMonthShort } from "@/lib/commissions/engine";

export const dynamic = "force-dynamic";

/** GET /api/commissions/individual-goals?month=YYYY-MM — a meta de cada pessoa nesse mês (sem linha = sem meta cadastrada). */
export const GET = commissionRoute(async function GET(req: Request) {
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  const month = new URL(req.url).searchParams.get("month");
  if (!isMonthKey(month)) return badRequest("Mês inválido");
  const [year, monthNum] = month.split("-").map(Number);

  return runWithTenant(access.organizationId, async () => {
    const goals = await prisma.commissionIndividualGoal.findMany({
      where: { organizationId: access.organizationId, year, month: monthNum },
      select: { userId: true, value: true },
    });
    return NextResponse.json(goals.map((g) => ({ userId: g.userId, value: Number(g.value) })));
  });
});

/** PATCH /api/commissions/individual-goals — { userId, month, value } · value null/0 apaga a meta (volta a "sem meta"). */
export const PATCH = commissionRoute(async function PATCH(req: Request) {
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return badRequest("Dados inválidos");
  if (typeof body.userId !== "string" || !body.userId) return badRequest("Escolha a pessoa");
  if (!isMonthKey(body.month)) return badRequest("Mês inválido");
  const month = body.month;
  const [year, monthNum] = month.split("-").map(Number);
  const value = body.value === null || body.value === "" ? 0 : parseMoney(body.value);
  if (value == null || value < 0) return badRequest("Informe a meta em R$");
  if (value > 100_000_000) return badRequest("Valor muito alto");
  const userId = body.userId;

  return runWithTenant(access.organizationId, async () => {
    const member = await prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId: access.organizationId, userId } },
      select: { user: { select: { name: true } } },
    });
    if (!member) return badRequest("Pessoa inválida");

    if (value === 0) {
      await prisma.commissionIndividualGoal.deleteMany({
        where: { organizationId: access.organizationId, userId, year, month: monthNum },
      });
    } else {
      await prisma.commissionIndividualGoal.upsert({
        where: { organizationId_userId_year_month: { organizationId: access.organizationId, userId, year, month: monthNum } },
        create: { organizationId: access.organizationId, userId, year, month: monthNum, value: value.toFixed(2), updatedById: access.userId },
        update: { value: value.toFixed(2), updatedById: access.userId },
      });
    }

    await auditCommission(req, access, "COMMISSION_INDIVIDUAL_GOAL_CHANGED", {
      targetType: "CommissionIndividualGoal",
      targetId: userId,
      detail:
        value === 0
          ? `Removeu a meta de ${member.user.name} em ${formatMonthShort(month)}`
          : `Meta de ${member.user.name} em ${formatMonthShort(month)}: R$ ${value.toFixed(2)}`,
    });
    return NextResponse.json({ userId, value });
  });
});
