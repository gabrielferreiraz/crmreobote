import { prisma } from "@/lib/prisma";

/**
 * Regra ÚNICA de "este lead pode ser assumido por outro consultor SEM pedir
 * aprovação a ninguém" — usada tanto pelo aviso de contato duplicado
 * (lib/contact-duplicate.ts → o que o modal oferece) quanto por
 * POST /api/lead-requests (o que de fato acontece ao clicar). Precisa ser a
 * MESMA função nos dois lugares: o botão que a tela mostra nunca pode
 * prometer "assumir na hora" e o servidor decidir "pedir aprovação" (ou
 * pior, o contrário — deixar passar por cima de um consultor ativo).
 *
 * Três motivos, nesta ordem de prioridade:
 *  - NO_OWNER: o contato nunca teve responsável.
 *  - OWNER_INACTIVE: o responsável saiu da empresa (OrganizationUser.active
 *    = false) — ninguém de fato cuida do lead.
 *  - LOST_OVER_3_MONTHS: o lead está PERDIDO há mais de 3 meses — só tem
 *    negócio(s) perdido(s), nenhum em andamento nem ganho, e o mais recente
 *    foi fechado como perdido há mais tempo que o prazo abaixo. Prazo
 *    contado no calendário (3 meses, não 90 dias).
 *
 * Contato com negócio ABERTO ou GANHO nunca cai no terceiro motivo, por
 * mais antigo que seja: aberto é trabalho em andamento, ganho é cliente de
 * verdade — nenhum dos dois é "lead perdido".
 */
export const LOST_LEAD_RELEASE_MONTHS = 3;

export type LeadClaimReason = "NO_OWNER" | "OWNER_INACTIVE" | "LOST_OVER_3_MONTHS";

export type LeadClaimEvaluation = {
  /** false também quando não há responsável nenhum. */
  ownerActive: boolean;
  /** Não-nulo = quem pediu pode assumir na hora, sem aprovação. Nulo = dono ativo cuidando do lead (só dá pra solicitar). */
  claimReason: LeadClaimReason | null;
  /** Quando o lead foi perdido pela última vez — só preenchido quando claimReason é LOST_OVER_3_MONTHS. */
  lostAt: Date | null;
};

export function lostLeadReleaseCutoff(now: Date = new Date()): Date {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - LOST_LEAD_RELEASE_MONTHS);
  return cutoff;
}

export async function evaluateLeadClaim(
  organizationId: string,
  contactId: string,
  responsavelId: string | null,
): Promise<LeadClaimEvaluation> {
  if (!responsavelId) return { ownerActive: false, claimReason: "NO_OWNER", lostAt: null };

  // Em paralelo — as duas consultas não dependem uma da outra, e cada
  // operação do Prisma custa várias idas-e-voltas ao Postgres por causa da
  // transação de RLS (ver withTenantRls em lib/prisma.ts).
  const [membership, dealsByStatus] = await Promise.all([
    prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId, userId: responsavelId } },
      select: { active: true },
    }),
    prisma.deal.groupBy({
      by: ["status"],
      where: { organizationId, contactId },
      _max: { closedAt: true },
    }),
  ]);

  const ownerActive = membership?.active ?? false;
  if (!ownerActive) return { ownerActive: false, claimReason: "OWNER_INACTIVE", lostAt: null };

  const hasOpenOrWon = dealsByStatus.some((g) => g.status === "OPEN" || g.status === "WON");
  if (hasOpenOrWon) return { ownerActive: true, claimReason: null, lostAt: null };

  // Só perdidos. `closedAt` nulo (raro: 9 de ~100 mil no banco) não prova
  // nada sobre "há quanto tempo" — nunca conta como elegível.
  const lostAt = dealsByStatus.find((g) => g.status === "LOST")?._max.closedAt ?? null;
  if (lostAt && lostAt <= lostLeadReleaseCutoff()) {
    return { ownerActive: true, claimReason: "LOST_OVER_3_MONTHS", lostAt };
  }
  return { ownerActive: true, claimReason: null, lostAt: null };
}
