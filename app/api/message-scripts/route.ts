import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const scripts = await prisma.messageScript.findMany({
      where: { organizationId: access.organizationId },
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { name: true } } },
    });
    return NextResponse.json(scripts);
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name, text } = body as { name?: string; text?: string };

  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!name?.trim()) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  if (!text?.trim()) return NextResponse.json({ error: "Escreva o texto do script" }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    const script = await prisma.messageScript.create({
      data: {
        organizationId: access.organizationId,
        name: name.trim(),
        text: text.trim(),
        createdById: access.userId,
      },
    });
    return NextResponse.json(script, { status: 201 });
  });
}
