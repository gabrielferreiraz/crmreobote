import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";

type LeadClaimClient = Pick<Prisma.TransactionClient, "organizationUser" | "deal" | "activity" | "task" | "whatsAppMessage">;

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
 *  - LOST_OVER_3_MONTHS: o lead está PERDIDO e PARADO há mais de 3 meses —
 *    só tem negócio(s) perdido(s), nenhum em andamento nem ganho, e faz mais
 *    que o prazo abaixo desde o ÚLTIMO destes dois: o negócio mais recente
 *    ser fechado como perdido, ou o responsável mexer no lead (ver
 *    lastOwnerTouch). Enquanto o responsável continua trabalhando o lead
 *    perdido, ele é dele — o prazo recomeça a cada movimento. Prazo contado
 *    no calendário (3 meses, não 90 dias).
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
  /**
   * Desde quando o lead está parado: o mais recente entre "perdido" e o último
   * movimento do responsável. Só preenchido quando claimReason é LOST_OVER_3_MONTHS.
   */
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
  client?: LeadClaimClient,
): Promise<LeadClaimEvaluation> {
  if (!responsavelId) return { ownerActive: false, claimReason: "NO_OWNER", lostAt: null };
  const db = client ?? (prisma as unknown as LeadClaimClient);

  // Em paralelo — as duas consultas não dependem uma da outra, e cada
  // operação do Prisma custa várias idas-e-voltas ao Postgres por causa da
  // transação de RLS (ver withTenantRls em lib/prisma.ts).
  const [membership, dealsByStatus] = await Promise.all([
    db.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId, userId: responsavelId } },
      select: { active: true },
    }),
    db.deal.groupBy({
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
  const cutoff = lostLeadReleaseCutoff();
  if (!lostAt || lostAt > cutoff) return { ownerActive: true, claimReason: null, lostAt: null };

  // Perdido há +3 meses — mas se o responsável mexeu depois, o prazo conta daí.
  const touchedAt = await lastOwnerTouch(db, organizationId, contactId, responsavelId);
  if (touchedAt && touchedAt > cutoff) return { ownerActive: true, claimReason: null, lostAt: null };
  return { ownerActive: true, claimReason: "LOST_OVER_3_MONTHS", lostAt: touchedAt && touchedAt > lostAt ? touchedAt : lostAt };
}

/**
 * Último movimento do RESPONSÁVEL no lead (null = nunca mexeu). Conta só o
 * que ele mesmo fez:
 *  - atividade registrada por ele no cliente ou num negócio do cliente — nota,
 *    ligação, reunião… e também edição do negócio e do cadastro (que viram
 *    atividade de sistema com o nome de quem editou);
 *  - tarefa dele no cliente/negócio, criada ou concluída;
 *  - mensagem de WhatsApp mandada por ele (pelo CRM ou pelo próprio celular).
 * Campanha e automação não contam: saem sozinhas, não são ele trabalhando o lead.
 */
async function lastOwnerTouch(
  db: LeadClaimClient,
  organizationId: string,
  contactId: string,
  ownerId: string,
): Promise<Date | null> {
  const ofContact = { OR: [{ contactId }, { deal: { contactId } }] };
  const [activity, createdTask, completedTask, message] = await Promise.all([
    db.activity.findFirst({
      // agendorTaskId = recriada pelo backfill do Agendor, não movimento de verdade.
      where: { organizationId, userId: ownerId, agendorTaskId: null, ...ofContact },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    db.task.findFirst({
      // Tarefa migrada do Agendor tem createdAt = dia da importação (30/07/2026),
      // não quando foi criada — contaria como movimento recente em milhares de
      // leads antigos. Dela só vale a conclusão (data real, consulta abaixo).
      where: { organizationId, ownerId, agendorTaskId: null, ...ofContact },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    db.task.findFirst({
      where: { organizationId, ownerId, completedAt: { not: null }, ...ofContact },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true },
    }),
    db.whatsAppMessage.findFirst({
      where: {
        organizationId,
        direction: "OUTBOUND",
        campaignId: null,
        automationRuleId: null,
        thread: { contactId },
        // Mandada pelo dono do número fica com sentByUserId nulo (ver
        // lib/whatsapp/send.ts) — inclusive a resposta pelo celular.
        OR: [{ sentByUserId: ownerId }, { sentByUserId: null, thread: { ownerUserId: ownerId } }],
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  const dates = [activity?.createdAt, createdTask?.createdAt, completedTask?.completedAt, message?.createdAt].filter(
    (d): d is Date => d instanceof Date,
  );
  return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
}
