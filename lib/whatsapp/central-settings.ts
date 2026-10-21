import { prismaRaw } from "@/lib/prisma";
import { setTenantOnTx } from "@/lib/tenant-context";
import { CentralLeadError } from "@/lib/whatsapp/lead-routing";

type DistributionPercentage = { userId: string; percent: number };

function equalDistribution(userIds: string[]): DistributionPercentage[] {
  const base = Math.floor(100 / userIds.length);
  const remainder = 100 % userIds.length;
  return userIds.map((userId, index) => ({
    userId,
    percent: base + (index < remainder ? 1 : 0),
  }));
}

function resolveDistribution(
  memberUserIds: string[],
  percentages?: DistributionPercentage[],
): Map<string, number> {
  const entries = percentages ?? equalDistribution(memberUserIds);
  if (entries.length !== memberUserIds.length) {
    throw new CentralLeadError("Defina a porcentagem de todos os atendentes");
  }

  const memberIds = new Set(memberUserIds);
  const resolved = new Map<string, number>();
  for (const entry of entries) {
    if (!memberIds.has(entry.userId) || resolved.has(entry.userId)) {
      throw new CentralLeadError("A distribuição contém atendente duplicado ou inválido");
    }
    if (!Number.isInteger(entry.percent) || entry.percent < 1 || entry.percent > 100) {
      throw new CentralLeadError("Cada atendente deve receber entre 1% e 100%");
    }
    resolved.set(entry.userId, entry.percent);
  }
  if (Array.from(resolved.values()).reduce((sum, percent) => sum + percent, 0) !== 100) {
    throw new CentralLeadError("A soma da distribuição deve ser 100%");
  }
  return resolved;
}

export async function saveCentralDistributionPool(params: {
  organizationId: string;
  name: string;
  memberUserIds: string[];
  distributionPercentages?: DistributionPercentage[];
  /** Quem fica no pool mas fora da distribuição (não recebe lead novo; mantém os atuais). */
  pausedUserIds?: string[];
}): Promise<string> {
  const memberUserIds = Array.from(new Set(params.memberUserIds));
  if (memberUserIds.length === 0) throw new CentralLeadError("Escolha ao menos um atendente");
  if (memberUserIds.length > 100) throw new CentralLeadError("A distribuição aceita no máximo 100 atendentes");
  const paused = new Set(params.pausedUserIds ?? []);
  if (Array.from(paused).some((id) => !memberUserIds.includes(id))) {
    throw new CentralLeadError("A lista de pausados contém atendente inválido");
  }
  if (memberUserIds.every((id) => paused.has(id))) throw new CentralLeadError("Deixe ao menos um atendente ativo");
  const distribution = resolveDistribution(memberUserIds, params.distributionPercentages);

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
      update: { nextIndex: 0 },
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
        create: {
          organizationId: params.organizationId,
          poolId,
          userId,
          position,
          pausedAt,
          distributionPercent: distribution.get(userId)!,
        },
        update: { position, pausedAt, distributionPercent: distribution.get(userId)! },
      });
    }
    return poolId;
  });
}
