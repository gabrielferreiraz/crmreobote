import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getCommissionAccess } from "@/lib/commissions/access";
import { forgetPageSync } from "@/lib/commissions/sync";
import { requireCommissionManager, auditCommission, badRequest, commissionRoute } from "@/lib/commissions/route-helpers";
import { parseAdministratorInput, tablePrismaData } from "@/lib/commissions/validation";
import { Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

/**
 * Lista curta (id + nome) das administradoras ATIVAS — é o seletor do
 * "Marcar como ganho", então qualquer pessoa ativa da organização pode ler.
 * `required` diz se a organização exige a escolha (tem ao menos uma ativa).
 */
export const GET = commissionRoute(async function GET() {
  const access = await getCommissionAccess();
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(access.organizationId, async () => {
    const [administrators, creditTypes] = await Promise.all([
      prisma.consortiumAdministrator.findMany({
        where: { organizationId: access.organizationId, active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.creditType.findMany({ where: { organizationId: access.organizationId }, orderBy: { order: "asc" }, select: { label: true } }),
    ]);
    // A categoria (Imóvel, Automóvel…) muda a comissão inteira — com o módulo
    // em uso, o "Ganho" pede as duas.
    return NextResponse.json({ administrators, creditTypes: creditTypes.map((c) => c.label), required: administrators.length > 0 });
  });
});

export const POST = commissionRoute(async function POST(req: Request) {
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Dados inválidos");
  const parsed = parseAdministratorInput(body as Record<string, unknown>, { partial: false });
  if (!parsed.ok) return badRequest(parsed.error);
  const { tables, ...general } = parsed.data;

  return runWithTenant(access.organizationId, async () => {
    try {
      const administrator = await prisma.consortiumAdministrator.create({
        data: {
          ...general,
          organizationId: access.organizationId,
          name: parsed.data.name!,
          // Tabela padrão + as de cada categoria, junto, numa escrita só.
          tables: { create: (tables ?? []).map((t) => tablePrismaData(access.organizationId, t)) },
        },
      });
      forgetPageSync(access.organizationId);
      await auditCommission(req, access, "COMMISSION_ADMINISTRATOR_CHANGED", {
        targetType: "ConsortiumAdministrator",
        targetId: administrator.id,
        detail: `Cadastrou ${administrator.name}`,
      });
      return NextResponse.json(administrator, { status: 201 });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return NextResponse.json({ error: "Já existe uma administradora com esse nome" }, { status: 409 });
      }
      throw err;
    }
  });
});
