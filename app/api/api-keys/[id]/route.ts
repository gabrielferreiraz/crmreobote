import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.apiKey.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!existing) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

    // Soft-revoke — mantém a linha (nome, quem criou, último uso) pro histórico,
    // só invalida a chave pra autenticação (ver lib/require-api-key.ts).
    await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    return NextResponse.json({ ok: true });
  });
}
