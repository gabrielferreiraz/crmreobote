import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { forgetPageSync } from "@/lib/commissions/sync";
import { requireCommissionManager, auditCommission, badRequest, commissionRoute } from "@/lib/commissions/route-helpers";
import { parseRuleInput } from "@/lib/commissions/validation";
import { describeRule } from "@/lib/commissions/describe";
import { checkRuleReferences } from "@/lib/commissions/rule-refs";

export const dynamic = "force-dynamic";

/** Mesma regra do cadastro de administradora: editar não recalcula venda nenhuma sozinho. */
export const PATCH = commissionRoute(async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Dados inválidos");
  const parsed = parseRuleInput(body as Record<string, unknown>, { partial: true });
  if (!parsed.ok) return badRequest(parsed.error);

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.commissionRule.findFirst({
      where: { id, organizationId: access.organizationId },
      include: { user: { select: { name: true } }, administrator: { select: { name: true } } },
    });
    if (!existing) return NextResponse.json({ error: "Regra não encontrada" }, { status: 404 });

    const refError = await checkRuleReferences(access.organizationId, parsed.data);
    if (refError) return badRequest(refError);

    const updated = await prisma.commissionRule.update({
      where: { id },
      data: parsed.data,
      include: { user: { select: { name: true } }, administrator: { select: { name: true } } },
    });
    forgetPageSync(access.organizationId);
    await auditCommission(req, access, "COMMISSION_RULE_CHANGED", {
      targetType: "CommissionRule",
      targetId: id,
      detail: `Editou: ${describeRule(existing)} → ${describeRule(updated)}${updated.active ? "" : " (desativada)"}`,
    });
    return NextResponse.json(updated);
  });
});

/** Parcela já gerada guarda a própria fotografia (percent/ruleId vira null) — apagar a regra não mexe em nada calculado. */
export const DELETE = commissionRoute(async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.commissionRule.findFirst({
      where: { id, organizationId: access.organizationId },
      include: { user: { select: { name: true } }, administrator: { select: { name: true } } },
    });
    if (!existing) return NextResponse.json({ error: "Regra não encontrada" }, { status: 404 });

    await prisma.commissionRule.delete({ where: { id } });
    forgetPageSync(access.organizationId);
    await auditCommission(req, access, "COMMISSION_RULE_CHANGED", {
      targetType: "CommissionRule",
      targetId: id,
      detail: `Excluiu: ${describeRule(existing)}`,
    });
    return NextResponse.json({ ok: true });
  });
});
