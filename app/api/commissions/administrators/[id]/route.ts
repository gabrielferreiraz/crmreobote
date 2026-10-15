import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { requireCommissionManager, auditCommission, badRequest } from "@/lib/commissions/route-helpers";
import { administratorPrismaData, existingRevenueFrom, parseAdministratorInput } from "@/lib/commissions/validation";
import { Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

/**
 * Editar NÃO recalcula venda nenhuma sozinho (comissão já calculada não muda
 * por baixo dos panos) — a tela oferece "aplicar às vendas sem parcela paga"
 * à parte (POST /api/commissions/sales/recalculate).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Dados inválidos");

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.consortiumAdministrator.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!existing) return NextResponse.json({ error: "Administradora não encontrada" }, { status: 404 });

    const parsed = parseAdministratorInput(body as Record<string, unknown>, { partial: true, existing: existingRevenueFrom(existing) });
    if (!parsed.ok) return badRequest(parsed.error);
    const rest = parsed.data;

    try {
      const updated = await prisma.consortiumAdministrator.update({
        where: { id },
        data: administratorPrismaData(rest),
      });
      await auditCommission(req, access, "COMMISSION_ADMINISTRATOR_CHANGED", {
        targetType: "ConsortiumAdministrator",
        targetId: id,
        detail: rest.active === false ? `Desativou ${updated.name}` : rest.active === true ? `Reativou ${updated.name}` : `Editou ${updated.name}`,
      });
      return NextResponse.json(updated);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return NextResponse.json({ error: "Já existe uma administradora com esse nome" }, { status: 409 });
      }
      throw err;
    }
  });
}

/** Só apaga se nunca foi usada — com venda/negócio apontando pra ela, o caminho é desativar. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.consortiumAdministrator.findFirst({
      where: { id, organizationId: access.organizationId },
      select: { id: true, name: true, _count: { select: { sales: true, deals: true } } },
    });
    if (!existing) return NextResponse.json({ error: "Administradora não encontrada" }, { status: 404 });
    if (existing._count.sales > 0 || existing._count.deals > 0) {
      return NextResponse.json(
        { error: "Essa administradora já tem vendas. Desative em vez de excluir — as vendas antigas continuam com ela." },
        { status: 409 },
      );
    }

    await prisma.consortiumAdministrator.delete({ where: { id } });
    await auditCommission(req, access, "COMMISSION_ADMINISTRATOR_CHANGED", {
      targetType: "ConsortiumAdministrator",
      targetId: id,
      detail: `Excluiu ${existing.name}`,
    });
    return NextResponse.json({ ok: true });
  });
}
