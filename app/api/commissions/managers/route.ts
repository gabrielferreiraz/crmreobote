import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { requireCommissionManager, auditCommission, badRequest, commissionRoute } from "@/lib/commissions/route-helpers";

export const dynamic = "force-dynamic";

/**
 * Liga/desliga "cuida das comissões" de uma pessoa — SÓ o Dono: é uma
 * permissão que dá visão da comissão de todo mundo, então quem já cuida
 * (o próprio Financeiro) não pode se dar mais gente nem se tirar.
 */
export const PATCH = commissionRoute(async function PATCH(req: Request) {
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;
  if (!access.isOwner) return NextResponse.json({ error: "Só o Dono pode mudar quem cuida das comissões" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { userId?: unknown; canManage?: unknown } | null;
  if (!body || typeof body.userId !== "string" || typeof body.canManage !== "boolean") return badRequest("Dados inválidos");
  const { userId, canManage } = body as { userId: string; canManage: boolean };

  return runWithTenant(access.organizationId, async () => {
    const membership = await prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId: access.organizationId, userId } },
      select: { active: true, user: { select: { name: true } } },
    });
    if (!membership) return NextResponse.json({ error: "Pessoa não encontrada" }, { status: 404 });
    if (canManage && !membership.active) return badRequest("Essa pessoa está desativada");

    await prisma.organizationUser.update({
      where: { organizationId_userId: { organizationId: access.organizationId, userId } },
      data: { canManageCommissions: canManage },
    });
    await auditCommission(req, access, "COMMISSION_MANAGER_CHANGED", {
      targetType: "User",
      targetId: userId,
      detail: `${membership.user.name}: ${canManage ? "passou a cuidar das comissões" : "não cuida mais das comissões"}`,
    });
    return NextResponse.json({ ok: true });
  });
});
