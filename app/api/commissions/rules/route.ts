import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { forgetPageSync } from "@/lib/commissions/sync";
import { requireCommissionManager, auditCommission, badRequest, commissionRoute } from "@/lib/commissions/route-helpers";
import { parseRuleInput } from "@/lib/commissions/validation";
import { checkRuleReferences } from "@/lib/commissions/rule-refs";
import { describeRule } from "@/lib/commissions/describe";

export const dynamic = "force-dynamic";

export const POST = commissionRoute(async function POST(req: Request) {
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Dados inválidos");
  const parsed = parseRuleInput(body as Record<string, unknown>, { partial: false });
  if (!parsed.ok) return badRequest(parsed.error);
  const data = parsed.data;

  return runWithTenant(access.organizationId, async () => {
    const refError = await checkRuleReferences(access.organizationId, data);
    if (refError) return badRequest(refError);

    const rule = await prisma.commissionRule.create({
      data: {
        organizationId: access.organizationId,
        beneficiaryRole: data.beneficiaryRole,
        userId: data.userId ?? null,
        administratorId: data.administratorId ?? null,
        modality: data.modality ?? null,
        creditType: data.creditType ?? null,
        base: data.base,
        percent: data.percent!,
      },
      include: { user: { select: { name: true } }, administrator: { select: { name: true } } },
    });
    forgetPageSync(access.organizationId);
    await auditCommission(req, access, "COMMISSION_RULE_CHANGED", {
      targetType: "CommissionRule",
      targetId: rule.id,
      detail: `Criou: ${describeRule(rule)}`,
    });
    return NextResponse.json(rule, { status: 201 });
  });
});
