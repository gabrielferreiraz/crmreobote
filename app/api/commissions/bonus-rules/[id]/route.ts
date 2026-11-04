import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { requireCommissionManager, auditCommission, badRequest, commissionRoute } from "@/lib/commissions/route-helpers";
import { parseBonusRuleInput } from "@/lib/commissions/validation";
import { checkRuleReferences } from "@/lib/commissions/rule-refs";

export const dynamic = "force-dynamic";

/** `tiers`, quando vem, SUBSTITUI as faixas atuais (apaga as antigas, cria as novas) — mesmo espírito de `tables` em administradoras. */
export const PATCH = commissionRoute(async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Dados inválidos");
  const parsed = parseBonusRuleInput(body as Record<string, unknown>, { partial: true });
  if (!parsed.ok) return badRequest(parsed.error);
  const data = parsed.data;

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.commissionBonusRule.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!existing) return NextResponse.json({ error: "Regra não encontrada" }, { status: 404 });

    const refError = await checkRuleReferences(access.organizationId, { userId: data.userId });
    if (refError) return badRequest(refError);

    const updated = await prisma.$transaction(async (tx) => {
      if (data.tiers) {
        await tx.commissionBonusTier.deleteMany({ where: { ruleId: id } });
      }
      return tx.commissionBonusRule.update({
        where: { id },
        data: {
          beneficiaryRole: data.beneficiaryRole,
          userId: data.userId,
          active: data.active,
          ...(data.tiers
            ? {
                tiers: {
                  create: data.tiers.map((t) => ({
                    organizationId: access.organizationId,
                    thresholdPercent: t.thresholdPercent,
                    rewardType: t.rewardType,
                    rewardValue: t.rewardValue,
                  })),
                },
              }
            : {}),
        },
        include: { user: { select: { name: true } }, tiers: { orderBy: { thresholdPercent: "asc" } } },
      });
    });

    await auditCommission(req, access, "COMMISSION_BONUS_RULE_CHANGED", {
      targetType: "CommissionBonusRule",
      targetId: id,
      detail: `Editou regra de bônus para ${updated.user?.name ?? "todo mundo"}${updated.active ? "" : " (desativada)"}`,
    });
    return NextResponse.json(updated);
  });
});

export const DELETE = commissionRoute(async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.commissionBonusRule.findFirst({
      where: { id, organizationId: access.organizationId },
      include: { user: { select: { name: true } } },
    });
    if (!existing) return NextResponse.json({ error: "Regra não encontrada" }, { status: 404 });

    // Prêmios já concedidos (CommissionBonusAward) NUNCA somem junto — eles
    // seguem apontando pro mesmo CommissionEntry que o consultor já viu
    // (onDelete: Cascade em CommissionBonusAward.ruleId apagaria o
    // histórico do award, mas o CommissionEntry em si, que é o que o
    // consultor de fato recebe, é independente e continua existindo).
    await prisma.commissionBonusRule.delete({ where: { id } });
    await auditCommission(req, access, "COMMISSION_BONUS_RULE_CHANGED", {
      targetType: "CommissionBonusRule",
      targetId: id,
      detail: `Excluiu regra de bônus para ${existing.user?.name ?? "todo mundo"}`,
    });
    return NextResponse.json({ ok: true });
  });
});
