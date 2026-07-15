import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { getDealScope, scopeWhere } from "@/lib/team-scope";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(access.organizationId, async () => {
    const scope = await getDealScope(access.organizationId, access.userId, access.role);
    const deal = await prisma.deal.findFirst({
      where: { id, organizationId: access.organizationId, ...scopeWhere(scope) },
    });
    if (!deal) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const activities = await prisma.activity.findMany({
      where: { dealId: id },
      orderBy: { createdAt: "desc" },
      include: { user: true },
    });

    return NextResponse.json(activities);
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { type, activityBody } = body as { type?: string; activityBody?: string };

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { organizationId, userId } = access;

  const validTypes = ["NOTE", "EMAIL", "CALL", "WHATSAPP", "PROPOSAL", "MEETING", "VISIT"];
  if (!type || !validTypes.includes(type)) {
    return NextResponse.json({ error: "type inválido" }, { status: 400 });
  }

  return runWithTenant(organizationId, async () => {
    const scope = await getDealScope(organizationId, userId, access.role);
    const deal = await prisma.deal.findFirst({ where: { id, organizationId, ...scopeWhere(scope) } });
    if (!deal) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const activity = await prisma.activity.create({
      data: {
        organizationId,
        dealId: id,
        contactId: deal.contactId,
        userId,
        type: type as
          | "NOTE"
          | "EMAIL"
          | "CALL"
          | "WHATSAPP"
          | "PROPOSAL"
          | "MEETING"
          | "VISIT",
        body: activityBody,
      },
      include: { user: true },
    });

    return NextResponse.json(activity, { status: 201 });
  });
}
