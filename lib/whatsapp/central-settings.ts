import { prismaRaw } from "@/lib/prisma";
import { setTenantOnTx } from "@/lib/tenant-context";
import { CentralLeadError } from "@/lib/whatsapp/lead-routing";

export async function saveCentralDistributionPool(params: {
  organizationId: string;
  name: string;
  memberUserIds: string[];
  /** Quem fica no pool mas fora do rodízio (não recebe lead NOVO; mantém os atuais). */
  pausedUserIds?: string[];
}): Promise<string> {
  const memberUserIds = Array.from(new Set(params.memberUserIds));
  if (memberUserIds.length === 0) throw new CentralLeadError("Escolha ao menos um atendente");
  const paused = new Set(params.pausedUserIds ?? []);
  if (memberUserIds.every((id) => paused.has(id))) throw new CentralLeadError("Deixe ao menos um atendente ativo");

  return prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, params.organizationId);
    const activeMembers = await tx.organizationUser.findMany({
      where: { organizationId: params.organizationId, active: true, userId: { in: memberUserIds } },
      select: { userId: true },
    });
    if (activeMembers.length !== memberUserIds.length) {
      throw new CentralLeadError("A lista contém usuário inativo ou de outra organização");
    }

    const centralInstance = await tx.whatsAppInstance.findFirst({
      where: { organizationId: params.organizationId, kind: "CENTRAL" },
      select: { id: true, distributionPoolId: true },
    });
    let poolId = centralInstance?.distributionPoolId ?? null;
    if (!poolId) {
      const existingPool = await tx.leadDistributionPool.findFirst({
        where: { organizationId: params.organizationId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      poolId = existingPool?.id ?? (
        await tx.leadDistributionPool.create({
          data: { organizationId: params.organizationId, name: params.name.trim() || "Central de Leads" },
          select: { id: true },
        })
      ).id;
      if (centralInstance) {
        await tx.whatsAppInstance.update({
          where: { id: centralInstance.id },
          data: { distributionPoolId: poolId },
        });
      }
    }

    await tx.leadDistributionPool.update({
      where: { id: poolId },
      data: { name: params.name.trim() || "Central de Leads", active: true },
    });
    await tx.leadDistributionCursor.upsert({
      where: { poolId },
      create: { organizationId: params.organizationId, poolId, nextIndex: 0 },
      update: {},
    });
    await tx.leadDistributionPoolMember.deleteMany({
      where: { poolId, userId: { notIn: memberUserIds } },
    });
    const current = await tx.leadDistributionPoolMember.findMany({
      where: { poolId },
      select: { userId: true, pausedAt: true },
    });
    const pausedAtByUser = new Map(current.map((member) => [member.userId, member.pausedAt]));
    const now = new Date();
    for (let position = 0; position < memberUserIds.length; position += 1) {
      const userId = memberUserIds[position];
      // Mantém o pausedAt original de quem já estava pausado (data de quando pausou).
      const pausedAt = paused.has(userId) ? (pausedAtByUser.get(userId) ?? now) : null;
      await tx.leadDistributionPoolMember.upsert({
        where: { poolId_userId: { poolId, userId } },
        create: { organizationId: params.organizationId, poolId, userId, position, pausedAt },
        update: { position, pausedAt },
      });
    }
    return poolId;
  });
}
