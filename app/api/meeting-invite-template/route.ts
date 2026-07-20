import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { sanitizeCell } from "@/lib/csv-sanitize";

export const dynamic = "force-dynamic";

/**
 * Template de convite de reunião — self-service (qualquer membro edita o
 * PRÓPRIO texto, sem checagem de papel; requireRole(["OWNER"]) não se aplica
 * aqui, isso não é gestão de organização). Nunca usa requireRole.
 */
export async function GET() {
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const membership = await prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { meetingInviteTemplate: true },
    });
    return NextResponse.json({ template: membership?.meetingInviteTemplate ?? null });
  });
}

export async function PUT(req: Request) {
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json();
  const { template } = body as { template?: string };
  if (typeof template !== "string" || !template.trim()) {
    return NextResponse.json({ error: "Texto do convite não pode ficar vazio" }, { status: 400 });
  }
  if (template.length > 2000) {
    return NextResponse.json({ error: "Texto do convite muito longo" }, { status: 400 });
  }

  return runWithTenant(organizationId, async () => {
    await prisma.organizationUser.update({
      where: { organizationId_userId: { organizationId, userId } },
      data: { meetingInviteTemplate: sanitizeCell(template) },
    });
    return NextResponse.json({ ok: true });
  });
}
