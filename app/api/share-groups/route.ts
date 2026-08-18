import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { validateShareGroupMemberIds } from "@/lib/share-groups";

export const dynamic = "force-dynamic";

/**
 * Grupos de compartilhamento entre consultores (agenda e/ou negócios — ver
 * lib/share-groups.ts). Dono/Gerente/Supervisor conseguem ver TODOS os
 * grupos da organização, mesmo os que não criaram — é assim que o admin
 * sabe "quem está compartilhando com quem" (pedido original). Só CRIAR é
 * liberado pros três papéis; EDITAR/APAGAR um grupo específico é restrito a
 * quem criou (ou ao Dono) — ver [id]/route.ts.
 */
export async function GET() {
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const groups = await prisma.shareGroup.findMany({
      where: { organizationId: access.organizationId },
      orderBy: { createdAt: "asc" },
      include: {
        createdBy: { select: { id: true, name: true } },
        members: { include: { user: { select: { id: true, name: true, email: true } } } },
      },
    });
    return NextResponse.json(groups);
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { name, memberIds, shareAgenda, shareDeals } = (body ?? {}) as {
    name?: string;
    memberIds?: string[];
    shareAgenda?: boolean;
    shareDeals?: boolean;
  };

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!name?.trim()) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  if (!Array.isArray(memberIds)) return NextResponse.json({ error: "memberIds é obrigatório" }, { status: 400 });
  if (shareAgenda === false && shareDeals !== true) {
    return NextResponse.json({ error: "Escolha ao menos um recurso pra compartilhar (agenda e/ou negócios)" }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    const validation = await validateShareGroupMemberIds(access.organizationId, access.userId, access.role, memberIds);
    if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });

    const group = await prisma.shareGroup.create({
      data: {
        organizationId: access.organizationId,
        name: name.trim(),
        createdById: access.userId,
        shareAgenda: shareAgenda ?? true,
        shareDeals: shareDeals ?? false,
        members: { create: Array.from(new Set(memberIds)).map((userId) => ({ userId })) },
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        members: { include: { user: { select: { id: true, name: true, email: true } } } },
      },
    });

    return NextResponse.json(group, { status: 201 });
  });
}
