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
  const { role, teamId, active, name, canManageProcesses, area, birthDate, email } = body as {
    role?: "OWNER" | "MANAGER" | "SUPERVISOR" | "MEMBER";
    teamId?: string | null;
    active?: boolean;
    name?: string;
    canManageProcesses?: boolean;
    area?: "VENDAS" | "ADMINISTRATIVO";
    /** "YYYY-MM-DD" (dia civil puro, ver User.birthDate no schema) ou null pra limpar. */
    birthDate?: string | null;
    email?: string;
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
    area === undefined &&
    birthDate === undefined &&
    email === undefined
  ) {
    return NextResponse.json(
      { error: "role, teamId, active, name, canManageProcesses, area, birthDate ou email é obrigatório" },
      { status: 400 },
    );
  }

  if (name !== undefined && !name.trim()) {
    return NextResponse.json({ error: "Nome não pode ficar vazio" }, { status: 400 });
  }

  // Mesma checagem simples de formato usada no cadastro (ver register/page.tsx
  // e app/api/org/members/route.ts) — e-mail é o login da pessoa, não pode
  // ficar vazio nem ir sem @ pro banco.
  const normalizedEmail = email?.trim().toLowerCase();
  if (email !== undefined && (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))) {
    return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
  }

  if (
    birthDate !== undefined &&
    birthDate !== null &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || Number.isNaN(new Date(birthDate).getTime()))
  ) {
    return NextResponse.json({ error: "Data de nascimento inválida" }, { status: 400 });
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

    // E-mail é o login — único no sistema inteiro, não só nesta organização
    // (User não tem organizationId, ver schema.prisma). Checa ANTES da
    // transação (mesmo padrão do POST em app/api/org/members/route.ts, que
    // já faz essa mesma busca sem runWithTenant — User é model global, RLS
    // não se aplica) pra devolver um erro claro em vez de estourar a
    // constraint única lá na escrita.
    if (normalizedEmail) {
      const existingWithEmail = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (existingWithEmail && existingWithEmail.id !== userId) {
        return NextResponse.json({ error: "Esse e-mail já está em uso por outro usuário" }, { status: 409 });
      }
    }

    const clearsLeadership = (role && role !== "SUPERVISOR") || active === false;
    const clearsManagement = (role && role !== "MANAGER") || active === false;

    const updated = await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, access.organizationId);

      // Nome, e-mail e data de nascimento vivem em User (compartilhado entre
      // organizações, se a pessoa fizer parte de mais de uma — ver POST em
      // app/api/org/members/route.ts, que reaproveita o User existente pelo
      // e-mail). Editar aqui muda os três em toda organização da pessoa, não
      // só nesta — aceitável no momento porque não há hoje nenhuma noção de
      // "perfil por organização". Trocar o e-mail troca o login também —
      // sessão já aberta em outro aparelho continua valendo até expirar ou
      // ser renovada (JWT, ver lib/auth.config.ts), não derruba na hora.
      const userUpdateData: { name?: string; birthDate?: Date | null; email?: string } = {};
      if (name !== undefined) userUpdateData.name = name.trim();
      if (birthDate !== undefined) userUpdateData.birthDate = birthDate ? new Date(birthDate) : null;
      if (normalizedEmail) userUpdateData.email = normalizedEmail;
      if (Object.keys(userUpdateData).length > 0) {
        await tx.user.update({ where: { id: userId }, data: userUpdateData });
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
