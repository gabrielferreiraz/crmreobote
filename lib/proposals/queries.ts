import { prisma } from "@/lib/prisma";
import { scopeWhere, type DealScope } from "@/lib/team-scope";
import { PROPOSAL_INCLUDE, serializeProposal } from "./serialize";
import type { ProposalDTO, ProposalPrintData } from "./types";

/**
 * Leituras de Proposta — sempre dentro de `runWithTenant` (quem chama), igual
 * qualquer outra consulta do app. Não exportam nada de mutação: escrita só
 * existe em lib/proposals/service.ts.
 */

/**
 * Propostas de UM negócio, da revisão mais nova pra mais antiga. Quem chama já
 * TEM que ter confirmado que o negócio está no escopo de quem pede (a página
 * do negócio faz isso ao carregar o próprio deal) — proposta herda a
 * visibilidade do negócio dela, igual Activity/Task, não tem escopo próprio.
 */
export async function listProposalsForDeal(organizationId: string, dealId: string): Promise<ProposalDTO[]> {
  const rows = await prisma.proposal.findMany({
    where: { organizationId, dealId },
    orderBy: { revision: "desc" },
    include: PROPOSAL_INCLUDE,
  });
  return rows.map(serializeProposal);
}

/**
 * Tudo que a página de impressão precisa, numa consulta só. Devolve null
 * (nunca lança) quando a proposta não existe OU o negócio dela está fora do
 * escopo de quem pede — a página trata os dois iguais (404), sem revelar que
 * a proposta existe pra quem não pode vê-la.
 */
export async function getProposalPrintData(
  organizationId: string,
  scope: DealScope,
  id: string,
): Promise<ProposalPrintData | null> {
  const row = await prisma.proposal.findFirst({
    where: { id, organizationId, deal: { organizationId, ...scopeWhere(scope) } },
    include: {
      createdBy: { select: { name: true, email: true } },
      sentBy: { select: { name: true, email: true } },
      organization: { select: { name: true } },
      deal: {
        select: {
          name: true,
          creditType: true,
          contact: { select: { name: true, email: true, phone: true, whatsapp: true } },
        },
      },
    },
  });
  if (!row) return null;

  const consultant = row.sentBy ?? row.createdBy;
  return {
    proposal: serializeProposal(row),
    dealName: row.deal.name,
    clientName: row.deal.contact.name,
    clientEmail: row.deal.contact.email,
    clientPhone: row.deal.contact.whatsapp || row.deal.contact.phone,
    creditType: row.deal.creditType,
    consultantName: consultant.name,
    consultantEmail: consultant.email,
    organizationName: row.organization.name,
  };
}
