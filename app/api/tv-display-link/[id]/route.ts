import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { logAudit } from "@/lib/audit-log";
import { getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.tvDisplayLink.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    // Soft-revoke — mantém a linha (quem criou, último uso) pro histórico,
    // só invalida o token pra autenticação (ver lib/require-tv-link.ts).
    await prisma.tvDisplayLink.update({ where: { id }, data: { revokedAt: new Date() } });

    await logAudit({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      actorName: access.session.user.name ?? access.session.user.email ?? "?",
      action: "TV_DISPLAY_LINK_REVOKED",
      targetType: "TvDisplayLink",
      targetId: existing.id,
      detail: `prefixo "${existing.tokenPrefix}…"`,
      ip: getClientIp(req),
    });

    return NextResponse.json({ ok: true });
  });
}
