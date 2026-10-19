import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit-log";
import { prisma } from "@/lib/prisma";
import { bodyErrorResponse, readJson } from "@/lib/read-body";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { centralLeadsEnabled } from "@/lib/whatsapp/central-config";
import { saveCentralDistributionPool } from "@/lib/whatsapp/central-settings";
import { CentralLeadError } from "@/lib/whatsapp/lead-routing";

// Configuração da Central (conexão + pool do rodízio): só o Dono lê e altera —
// a lista traz todos os membros e cargos da organização.
export async function GET() {
  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { organizationId } = access;

  return runWithTenant(organizationId, async () => {
    const [instance, availableMembers] = await Promise.all([
      prisma.whatsAppInstance.findFirst({
        where: { organizationId, kind: "CENTRAL" },
        select: {
          id: true,
          provider: true,
          status: true,
          phoneNumber: true,
          distributionPool: {
            select: {
              id: true,
              name: true,
              active: true,
              members: {
                orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
                select: { userId: true, position: true, pausedAt: true, user: { select: { name: true } } },
              },
            },
          },
        },
      }),
      prisma.organizationUser.findMany({
        where: { organizationId, active: true },
        orderBy: { user: { name: "asc" } },
        select: { userId: true, role: true, user: { select: { name: true } } },
      }),
    ]);
    return NextResponse.json({ enabled: centralLeadsEnabled(), instance, availableMembers });
  });
}

export async function PUT(request: Request) {
  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  let body: { name?: string; memberUserIds?: string[]; pausedUserIds?: string[] };
  try {
    body = await readJson(request) as typeof body;
  } catch (error) {
    return bodyErrorResponse(error) ?? NextResponse.json({ error: "Corpo inválido" }, { status: 400 });
  }
  if (!Array.isArray(body.memberUserIds) || body.memberUserIds.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "Escolha os atendentes" }, { status: 400 });
  }
  const pausedUserIds = Array.isArray(body.pausedUserIds)
    ? body.pausedUserIds.filter((id): id is string => typeof id === "string")
    : [];

  return runWithTenant(access.organizationId, async () => {
    try {
      const poolId = await saveCentralDistributionPool({
        organizationId: access.organizationId,
        name: body.name ?? "Central de Leads",
        memberUserIds: body.memberUserIds!,
        pausedUserIds,
      });
      await logAudit({
        organizationId: access.organizationId,
        actorUserId: access.userId,
        actorName: access.session?.user?.name ?? "Dono",
        action: "CENTRAL_SETTINGS_CHANGED",
        targetType: "LeadDistributionPool",
        targetId: poolId,
        detail: `${body.memberUserIds!.length} atendente(s), ${pausedUserIds.length} pausado(s)`,
      });
      return NextResponse.json({ poolId });
    } catch (error) {
      if (error instanceof CentralLeadError) return NextResponse.json({ error: error.message }, { status: 400 });
      console.error("[wa:central] falha ao salvar rodízio", error);
      return NextResponse.json({ error: "Não foi possível salvar. Tente de novo." }, { status: 500 });
    }
  });
}
