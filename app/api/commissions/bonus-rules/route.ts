import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { requireCommissionManager, auditCommission, badRequest, commissionRoute } from "@/lib/commissions/route-helpers";
import { parseBonusRuleInput } from "@/lib/commissions/validation";
import { checkRuleReferences } from "@/lib/commissions/rule-refs";

export const dynamic = "force-dynamic";

export const GET = commissionRoute(async function GET() {
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  return runWithTenant(access.organizationId, async () => {
    const rules = await prisma.commissionBonusRule.findMany({
      where: { organizationId: access.organizationId },
      include: { user: { select: { id: true, name: true } }, tiers: { orderBy: { thresholdPercent: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json(
      rules.map((r) => ({
        id: r.id,
        beneficiaryRole: r.beneficiaryRole,
        userId: r.userId,
        userName: r.user?.name ?? null,
        active: r.active,
        tiers: r.tiers.map((t) => ({
          id: t.id,
          thresholdPercent: Number(t.thresholdPercent),
          rewardType: t.rewardType,
          rewardValue: Number(t.rewardValue),
        })),
      })),
    );
  });
});

export const POST = commissionRoute(async function POST(req: Request) {
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Dados inválidos");
  const parsed = parseBonusRuleInput(body as Record<string, unknown>, { partial: false });
  if (!parsed.ok) return badRequest(parsed.error);
  const data = parsed.data;

  return runWithTenant(access.organizationId, async () => {
    const refError = await checkRuleReferences(access.organizationId, { userId: data.userId });
    if (refError) return badRequest(refError);

    const rule = await prisma.commissionBonusRule.create({
      data: {
        organizationId: access.organizationId,
        beneficiaryRole: data.beneficiaryRole!,
        userId: data.userId ?? null,
        active: data.active ?? true,
        tiers: {
          create: data.tiers!.map((t) => ({
            organizationId: access.organizationId,
            thresholdPercent: t.thresholdPercent,
            rewardType: t.rewardType,
            rewardValue: t.rewardValue,
          })),
        },
      },
      include: { user: { select: { name: true } }, tiers: true },
    });
    await auditCommission(req, access, "COMMISSION_BONUS_RULE_CHANGED", {
      targetType: "CommissionBonusRule",
      targetId: rule.id,
      detail: `Criou regra de bônus para ${rule.user?.name ?? "todo mundo"} (${rule.tiers.length} faixa${rule.tiers.length === 1 ? "" : "s"})`,
    });
    return NextResponse.json(rule, { status: 201 });
  });
});
