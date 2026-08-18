import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { validateShareGroupMemberIds } from "@/lib/share-groups";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const { name, memberIds, shareAgenda, shareDeals } = (body ?? {}) as {
    name?: string;
    memberIds?: string[];
    shareAgenda?: boolean;
    shareDeals?: boolean;
  };

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const group = await prisma.shareGroup.findFirst({
      where: { id, organizationId: access.organizationId },
    });
    if (!group) return NextResponse.json({ error: "Grupo não encontrado" }, { status: 404 });
    // Só quem criou (ou o Dono) mexe num grupo — evita um Supervisor alterar
    // um grupo multi-equipe que um Gerente/Dono montou (ver GET, que já
    // mostra todos os grupos pra todo mundo, só a EDIÇÃO é restrita).
    if (access.role !== "OWNER" && group.createdById !== access.userId) {
      return NextResponse.json({ error: "Só quem criou o grupo (ou o Dono) pode editá-lo" }, { status: 403 });
    }

    const nextShareAgenda = shareAgenda ?? group.shareAgenda;
    const nextShareDeals = shareDeals ?? group.shareDeals;
    if (!nextShareAgenda && !nextShareDeals) {
      return NextResponse.json({ error: "Escolha ao menos um recurso pra compartilhar (agenda e/ou negócios)" }, { status: 400 });
    }

    if (memberIds !== undefined) {
      if (!Array.isArray(memberIds)) return NextResponse.json({ error: "memberIds inválido" }, { status: 400 });
      const validation = await validateShareGroupMemberIds(access.organizationId, access.userId, access.role, memberIds);
      if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });

      const uniqueIds = Array.from(new Set(memberIds));
      // Substitui o conjunto inteiro (não é um "adicionar um" incremental) —
      // mais simples do lado do cliente, que já manda a lista completa
      // desejada a cada mudança (ver share-group-manager.tsx).
      await prisma.shareGroupMember.deleteMany({ where: { groupId: id } });
      await prisma.shareGroupMember.createMany({ data: uniqueIds.map((userId) => ({ groupId: id, userId })) });
    }

    const updated = await prisma.shareGroup.update({
      where: { id },
      data: {
        name: name?.trim() || undefined,
        shareAgenda: shareAgenda === undefined ? undefined : shareAgenda,
        shareDeals: shareDeals === undefined ? undefined : shareDeals,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        members: { include: { user: { select: { id: true, name: true, email: true } } } },
      },
    });

    return NextResponse.json(updated);
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const group = await prisma.shareGroup.findFirst({
      where: { id, organizationId: access.organizationId },
    });
    if (!group) return NextResponse.json({ error: "Grupo não encontrado" }, { status: 404 });
    if (access.role !== "OWNER" && group.createdById !== access.userId) {
      return NextResponse.json({ error: "Só quem criou o grupo (ou o Dono) pode apagá-lo" }, { status: 403 });
    }

    await prisma.shareGroup.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
