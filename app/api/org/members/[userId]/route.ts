import { NextResponse } from "next/server";
import { prisma, prismaRaw } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { deleteAvatar } from "@/lib/r2";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { cleanupInstanceIfDisconnected } from "@/lib/whatsapp/instance-cleanup";
import { logAudit } from "@/lib/audit-log";
import { getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const body = await req.json();
  const { role, teamId, active, name, canManageProcesses, area } = body as {
    role?: "OWNER" | "MANAGER" | "SUPERVISOR" | "MEMBER";
    teamId?: string | null;
    active?: boolean;
    name?: string;
    canManageProcesses?: boolean;
    area?: "VENDAS" | "ADMINISTRATIVO";
  };

  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (area !== undefined && area !== "VENDAS" && area !== "ADMINISTRATIVO") {
    return NextResponse.json({ error: "area inválida" }, { status: 400 });
  }

  if (
    !role &&
    teamId === undefined &&
    active === undefined &&
    name === undefined &&
    canManageProcesses === undefined &&
    area === undefined
  ) {
    return NextResponse.json({ error: "role, teamId, active, name, canManageProcesses ou area é obrigatório" }, { status: 400 });
  }

  if (name !== undefined && !name.trim()) {
    return NextResponse.json({ error: "Nome não pode ficar vazio" }, { status: 400 });
  }

  if (active === false && userId === access.userId) {
    return NextResponse.json({ error: "Você não pode desativar a si mesmo" }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    const membership = await prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId: access.organizationId, userId } },
    });
    if (!membership) return NextResponse.json({ error: "Membro não encontrado" }, { status: 404 });

    const losesOwnerStatus = (role && membership.role === "OWNER" && role !== "OWNER") ||
      (active === false && membership.role === "OWNER");
    if (losesOwnerStatus) {
      const ownerCount = await prisma.organizationUser.count({
        where: { organizationId: access.organizationId, role: "OWNER", active: true },
      });
      if (ownerCount <= 1) {
        return NextResponse.json(
          { error: "A organização precisa de ao menos um dono ativo" },
          { status: 409 },
        );
      }
    }

    if (teamId) {
      const team = await prisma.team.findFirst({
        where: { id: teamId, organizationId: access.organizationId },
      });
      if (!team) return NextResponse.json({ error: "Equipe inválida" }, { status: 400 });
    }

    const clearsLeadership = (role && role !== "SUPERVISOR") || active === false;
    const clearsManagement = (role && role !== "MANAGER") || active === false;

    const updated = await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, access.organizationId);

      // Nome vive em User (compartilhado entre organizações, se a pessoa fizer
      // parte de mais de uma — ver POST em app/api/org/members/route.ts, que
      // reaproveita o User existente pelo e-mail). Editar aqui muda o nome em
      // toda organização da pessoa, não só nesta — aceitável no momento porque
      // não há hoje nenhuma noção de "nome de exibição por organização".
      if (name !== undefined) {
        await tx.user.update({ where: { id: userId }, data: { name: name.trim() } });
      }

      const updatedMembership = await tx.organizationUser.update({
        where: { organizationId_userId: { organizationId: access.organizationId, userId } },
        data: { role, teamId, active, canManageProcesses, area },
        include: { user: { select: { id: true, name: true, email: true, image: true } } },
      });

      if (clearsLeadership) {
        await tx.team.updateMany({
          where: { organizationId: access.organizationId, leaderId: userId },
          data: { leaderId: null },
        });
      }

      if (clearsManagement) {
        await tx.team.updateMany({
          where: { organizationId: access.organizationId, managerId: userId },
          data: { managerId: null },
        });
      }

      return updatedMembership;
    });

    if (active === false) {
      const previousKey = updated.user.image?.startsWith("avatars/") ? updated.user.image : null;
      if (previousKey) {
        await prisma.user.update({ where: { id: userId }, data: { image: null } });
        await deleteAvatar(previousKey).catch(() => {});
      }
      // Só remove aqui se já estiver desconectada — enquanto conectada, a
      // limpeza fica pro webhook/health-check pegar na próxima queda (nunca
      // derruba uma sessão que ainda está de pé só por causa da desativação).
      await cleanupInstanceIfDisconnected(access.organizationId, userId);

      // PushSubscription é por User (global, sem organizationId — ver
      // schema.prisma), então só apaga se a pessoa não tiver NENHUMA outra
      // organização ativa; senão um dono desativando alguém na Org A cortaria
      // push de negócios/tarefas dela na Org B também.
      const remainingActive = await prisma.organizationUser.count({ where: { userId, active: true } });
      if (remainingActive === 0) {
        await prisma.pushSubscription.deleteMany({ where: { userId } });
      }
    }

    const actorName = access.session.user.name ?? access.session.user.email ?? "?";
    const ip = getClientIp(req);
    if (role && role !== membership.role) {
      await logAudit({
        organizationId: access.organizationId,
        actorUserId: access.userId,
        actorName,
        action: "MEMBER_ROLE_CHANGED",
        targetType: "User",
        targetId: userId,
        detail: `${updated.user.name}: ${membership.role} → ${role}`,
        ip,
      });
    }
    if (active === false && membership.active) {
      await logAudit({
        organizationId: access.organizationId,
        actorUserId: access.userId,
        actorName,
        action: "MEMBER_DEACTIVATED",
        targetType: "User",
        targetId: userId,
        detail: updated.user.name,
        ip,
      });
    }
    if (active === true && !membership.active) {
      await logAudit({
        organizationId: access.organizationId,
        actorUserId: access.userId,
        actorName,
        action: "MEMBER_REACTIVATED",
        targetType: "User",
        targetId: userId,
        detail: updated.user.name,
        ip,
      });
    }

    return NextResponse.json(updated);
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;

  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const membership = await prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId: access.organizationId, userId } },
      include: { user: { select: { name: true } } },
    });
    if (!membership) return NextResponse.json({ error: "Membro não encontrado" }, { status: 404 });

    if (membership.role === "OWNER") {
      const ownerCount = await prisma.organizationUser.count({
        where: { organizationId: access.organizationId, role: "OWNER" },
      });
      if (ownerCount <= 1) {
        return NextResponse.json(
          { error: "A organização precisa de ao menos um dono" },
          { status: 409 },
        );
      }
    }

    await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, access.organizationId);

      await tx.team.updateMany({
        where: { organizationId: access.organizationId, leaderId: userId },
        data: { leaderId: null },
      });

      await tx.team.updateMany({
        where: { organizationId: access.organizationId, managerId: userId },
        data: { managerId: null },
      });

      await tx.organizationUser.delete({
        where: { organizationId_userId: { organizationId: access.organizationId, userId } },
      });
    });

    // Mesma regra da desativação: só remove aqui se já estiver desconectada;
    // conectada, espera o webhook/health-check pegar na próxima queda.
    await cleanupInstanceIfDisconnected(access.organizationId, userId);

    // Mesmo cuidado do PATCH: só limpa a inscrição de push (global por User)
    // se não sobrar nenhuma outra organização ativa pra essa pessoa.
    const remainingActive = await prisma.organizationUser.count({ where: { userId, active: true } });
    if (remainingActive === 0) {
      await prisma.pushSubscription.deleteMany({ where: { userId } });
    }

    const remainingMemberships = await prisma.organizationUser.count({ where: { userId } });
    if (remainingMemberships === 0) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { image: true } });
      const previousKey = user?.image?.startsWith("avatars/") ? user.image : null;
      if (previousKey) {
        await prisma.user.update({ where: { id: userId }, data: { image: null } });
        await deleteAvatar(previousKey).catch(() => {});
      }
    }

    await logAudit({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      actorName: access.session.user.name ?? access.session.user.email ?? "?",
      action: "MEMBER_REMOVED",
      targetType: "User",
      targetId: userId,
      detail: membership.user.name,
      ip: getClientIp(req),
    });

    return NextResponse.json({ ok: true });
  });
}
