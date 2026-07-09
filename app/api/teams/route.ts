import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const teams = await prisma.team.findMany({
      where: { organizationId: access.organizationId },
      orderBy: { createdAt: "asc" },
      include: {
        leader: { select: { id: true, name: true } },
        members: { include: { user: { select: { id: true, name: true, email: true } } } },
      },
    });

    return NextResponse.json(teams);
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name } = body as { name?: string };

  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!name?.trim()) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    const team = await prisma.team.create({
      data: { organizationId: access.organizationId, name: name.trim() },
      include: { leader: { select: { id: true, name: true } }, members: true },
    });

    return NextResponse.json(team, { status: 201 });
  });
}
