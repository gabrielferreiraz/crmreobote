import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/require-api-key";
import { runWithTenant } from "@/lib/tenant-context";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { apiSuccess, apiError } from "@/lib/api/v1-response";
import { resolveAvatarUrlMap } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Lista os membros do time (responsáveis) da organização — pensado pra um
 * sistema externo montar seu próprio Select de "responsável" sem precisar
 * abrir o CRM. Só leitura, sem paginação de propósito (times cabem numa
 * chamada só; se um dia isso mudar, paginar aqui). Nunca inclui senha nem
 * qualquer coisa de autenticação — só o que é seguro mostrar fora daqui.
 */
export async function GET(req: Request) {
  const access = await requireApiKey(req);
  if (!access.ok) return apiError("Chave de API inválida ou revogada", 401);

  const rateLimited = rateLimitOrResponse(`apikey:${access.apiKeyId}:members`, 60, 60_000);
  if (rateLimited) return rateLimited;

  return runWithTenant(access.organizationId, async () => {
    const [members, teams] = await Promise.all([
      prisma.organizationUser.findMany({
        where: { organizationId: access.organizationId },
        orderBy: { createdAt: "asc" },
        include: {
          user: { select: { id: true, name: true, email: true, image: true } },
          team: { select: { id: true, name: true, leaderId: true } },
        },
      }),
      // `team` acima é "de qual equipe esta pessoa é MEMBRO" (OrganizationUser.teamId)
      // — campo independente de QUEM LIDERA essa equipe (Team.leaderId). Um
      // Supervisor pode liderar uma equipe sem aparecer como membro dela (não
      // é incomum nesta organização), então o `team` de cima pode vir `null`
      // mesmo pra quem lidera. `teamsLed` resolve isso à parte, pela relação
      // real de liderança, não pela filiação.
      prisma.team.findMany({ where: { organizationId: access.organizationId }, select: { id: true, name: true, leaderId: true } }),
    ]);

    const avatarMap = await resolveAvatarUrlMap(members.map((m) => m.user.image));
    const teamsLedByUserId = new Map<string, { id: string; name: string }[]>();
    for (const t of teams) {
      if (!t.leaderId) continue;
      const list = teamsLedByUserId.get(t.leaderId) ?? [];
      list.push({ id: t.id, name: t.name });
      teamsLedByUserId.set(t.leaderId, list);
    }

    return apiSuccess({
      members: members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        area: m.area,
        active: m.active,
        teamId: m.teamId,
        team: m.team ? { id: m.team.id, name: m.team.name, leaderId: m.team.leaderId } : null,
        teamsLed: teamsLedByUserId.get(m.user.id) ?? [],
        photoUrl: m.user.image ? (avatarMap.get(m.user.image) ?? null) : null,
        memberSince: m.createdAt,
      })),
    });
  });
}
