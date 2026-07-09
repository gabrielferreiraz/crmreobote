import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const reasons = await prisma.lossReason.findMany({
      where: { organizationId },
      orderBy: { order: "asc" },
    });

    return NextResponse.json(reasons);
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { label } = body as { label?: string };

  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!label?.trim()) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    const maxOrder = await prisma.lossReason.aggregate({
      where: { organizationId: access.organizationId },
      _max: { order: true },
    });

    const reason = await prisma.lossReason.create({
      data: {
        organizationId: access.organizationId,
        label: label.trim(),
        order: (maxOrder._max.order ?? -1) + 1,
      },
    });

    return NextResponse.json(reason, { status: 201 });
  });
}
