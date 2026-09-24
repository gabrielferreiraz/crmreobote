import type { Prisma } from "@/app/generated/prisma/client";
import type { ProposalDTO } from "./types";

/**
 * Sempre que uma consulta de Proposta vai virar ProposalDTO (tela/API), traz
 * junto o NOME de quem criou/enviou — a timeline e o cartão mostram "por
 * Fulano", e sem isso cada linha exigiria uma consulta extra de usuário.
 * `select` só de name (User inteiro traria o hash de senha — mesmo cuidado já
 * documentado em app/(dashboard)/page.tsx).
 */
export const PROPOSAL_INCLUDE = {
  createdBy: { select: { name: true } },
  sentBy: { select: { name: true } },
} satisfies Prisma.ProposalInclude;

export type ProposalWithUsers = Prisma.ProposalGetPayload<{ include: typeof PROPOSAL_INCLUDE }>;

/** Decimal do Prisma e Date não atravessam pro Client Component — tudo vira number/ISO string aqui, num lugar só. */
export function serializeProposal(p: ProposalWithUsers): ProposalDTO {
  return {
    id: p.id,
    dealId: p.dealId,
    number: p.number,
    revision: p.revision,
    parentId: p.parentId,
    status: p.status,
    credit: Number(p.credit),
    termMonths: p.termMonths,
    installment: Number(p.installment),
    quotaCount: p.quotaCount,
    description: p.description,
    createdById: p.createdById,
    createdByName: p.createdBy.name,
    sentById: p.sentById,
    sentByName: p.sentBy?.name ?? null,
    generatedAt: p.generatedAt?.toISOString() ?? null,
    sentAt: p.sentAt?.toISOString() ?? null,
    resolvedAt: p.resolvedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}
