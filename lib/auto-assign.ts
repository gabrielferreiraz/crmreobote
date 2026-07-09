import { prisma } from "@/lib/prisma";

export async function pickOwnerId(organizationId: string, fallbackUserId: string) {
  const members = await prisma.organizationUser.findMany({
    where: { organizationId, active: true },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });

  if (members.length === 0) return fallbackUserId;

  const loads = await prisma.deal.groupBy({
    by: ["ownerId"],
    where: { organizationId, status: "OPEN" },
    _count: true,
  });

  const loadByUser = new Map(loads.map((l) => [l.ownerId, l._count]));

  let picked = members[0].userId;
  let lowest = loadByUser.get(picked) ?? 0;

  for (const member of members) {
    const count = loadByUser.get(member.userId) ?? 0;
    if (count < lowest) {
      lowest = count;
      picked = member.userId;
    }
  }

  return picked;
}
