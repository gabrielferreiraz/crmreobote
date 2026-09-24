import { prismaRaw } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { setTenantOnTx } from "@/lib/tenant-context";
import { scopeWhere, type DealScope } from "@/lib/team-scope";
import { formatCurrency } from "@/lib/format";
import { PROPOSAL_INCLUDE, serializeProposal, type ProposalWithUsers } from "./serialize";
import { formatProposalNumber, isProposalEditable, PROPOSAL_STATUS_LABEL, type ProposalDTO, type ProposalStatus } from "./types";
import type { ProposalFields } from "./validate";

/**
 * Toda mutação de Proposta passa por aqui — nunca direto de uma rota. Três
 * garantias, todas no MESMO lugar de propósito (esquecer uma delas numa rota
 * nova já foi a origem de 3 vazamentos neste projeto, ver [[security_posture_2026_07]]):
 *
 * 1. Escopo: a proposta só é achada se o NEGÓCIO dela está no escopo de quem
 *    pede (getSharedScope → scopeWhere, igual atividades/tarefas). Fora do
 *    escopo é 404, nunca 403 — não revela que a proposta existe.
 * 2. Atomicidade: transição de estado + linha na timeline do negócio (Activity
 *    SYSTEM) + (no "Refazer") a proposta nova, tudo numa transação de
 *    verdade. prismaRaw.$transaction com CALLBACK, não a forma em array — a
 *    forma em array NÃO é atômica neste setup (Prisma 7 + adapter-pg, ver
 *    scripts/fix-ghost-consultants.ts), e um "Refazer" que deixasse a antiga
 *    como SUPERSEDED sem ter criado a nova é exatamente o meio-estado que isto
 *    existe pra impedir.
 * 3. Trava otimista: toda transição é um updateMany com o(s) status de
 *    ORIGEM no `where` e checa `count === 1` — duplo clique ou duas abas
 *    marcando "enviada" ao mesmo tempo não duplicam a timeline nem
 *    sobrescrevem sentAt/sentById de quem chegou primeiro.
 */

export type ProposalActor = { organizationId: string; userId: string; scope: DealScope };

export type ServiceError = { ok: false; status: 400 | 404 | 409; error: string; retryable?: boolean };
export type ServiceResult<T> = { ok: true; value: T } | ServiceError;

class ProposalServiceError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

async function runTx<T>(actor: ProposalActor, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<ServiceResult<T>> {
  try {
    const value = await prismaRaw.$transaction(
      async (tx) => {
        await setTenantOnTx(tx, actor.organizationId);
        return fn(tx);
      },
      { timeout: 15_000 },
    );
    return { ok: true, value };
  } catch (err) {
    if (err instanceof ProposalServiceError) return { ok: false, status: err.status, error: err.message };
    // (dealId, revision) único — duas pessoas criaram revisão ao mesmo tempo
    // no mesmo negócio e ambas calcularam o mesmo "próximo número".
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return {
        ok: false,
        status: 409,
        error: "Outra pessoa criou uma proposta neste negócio ao mesmo tempo — tente de novo.",
        retryable: true,
      };
    }
    throw err;
  }
}

type LoadedProposal = ProposalWithUsers & { deal: { id: string; contactId: string } };

async function loadInScope(tx: Prisma.TransactionClient, actor: ProposalActor, id: string): Promise<LoadedProposal> {
  const proposal = await tx.proposal.findFirst({
    where: {
      id,
      organizationId: actor.organizationId,
      deal: { organizationId: actor.organizationId, ...scopeWhere(actor.scope) },
    },
    include: { ...PROPOSAL_INCLUDE, deal: { select: { id: true, contactId: true } } },
  });
  if (!proposal) throw new ProposalServiceError(404, "Proposta não encontrada");
  return proposal;
}

function label(p: { number: number; revision: number }): string {
  return `proposta Nº ${formatProposalNumber(p.number)} (revisão ${p.revision})`;
}

async function logActivity(
  tx: Prisma.TransactionClient,
  actor: ProposalActor,
  p: { deal: { id: string; contactId: string } },
  body: string,
): Promise<void> {
  await tx.activity.create({
    data: {
      organizationId: actor.organizationId,
      dealId: p.deal.id,
      contactId: p.deal.contactId,
      userId: actor.userId,
      type: "SYSTEM",
      body,
    },
  });
}

/** Trava otimista — ver comentário no topo do arquivo, item 3. */
async function transition(
  tx: Prisma.TransactionClient,
  actor: ProposalActor,
  id: string,
  from: ProposalStatus[],
  data: Prisma.ProposalUncheckedUpdateManyInput,
): Promise<void> {
  const result = await tx.proposal.updateMany({
    where: { id, organizationId: actor.organizationId, status: { in: from } },
    data,
  });
  if (result.count !== 1) {
    throw new ProposalServiceError(409, "A proposta mudou de estado enquanto você olhava — atualize a página e tente de novo.");
  }
}

async function reload(tx: Prisma.TransactionClient, id: string): Promise<ProposalDTO> {
  const fresh = await tx.proposal.findUniqueOrThrow({ where: { id }, include: PROPOSAL_INCLUDE });
  return serializeProposal(fresh);
}

async function nextRevision(tx: Prisma.TransactionClient, dealId: string): Promise<number> {
  const agg = await tx.proposal.aggregate({ where: { dealId }, _max: { revision: true } });
  return (agg._max.revision ?? 0) + 1;
}

// ─── Criação ────────────────────────────────────────────────────────────

export type CreateProposalInput =
  | { dealId: string; fields: ProposalFields }
  // A partir de uma RECUSADA (cliente voltou pedindo outra condição) — copia
  // os valores e aponta parentId pra ela, sem mexer no estado da recusada.
  | { dealId: string; fromProposalId: string };

export async function createProposal(actor: ProposalActor, input: CreateProposalInput): Promise<ServiceResult<ProposalDTO>> {
  // Até 3 tentativas: a única falha "retentável" é a colisão de (dealId,
  // revision) entre dois criadores simultâneos — na 2ª tentativa o MAX já
  // enxerga a revisão do outro e calcula o número certo.
  let last: ServiceResult<ProposalDTO> | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    last = await runTx(actor, async (tx) => {
      const deal = await tx.deal.findFirst({
        where: { id: input.dealId, organizationId: actor.organizationId, ...scopeWhere(actor.scope) },
        select: { id: true },
      });
      if (!deal) throw new ProposalServiceError(404, "Negócio não encontrado");

      let base: { credit: Prisma.Decimal | number; termMonths: number; installment: Prisma.Decimal | number; quotaCount: number; description: string };
      let parentId: string | null = null;

      if ("fromProposalId" in input) {
        const source = await loadInScope(tx, actor, input.fromProposalId);
        if (source.dealId !== input.dealId) throw new ProposalServiceError(400, "A proposta de origem é de outro negócio");
        if (source.status !== "DECLINED") {
          throw new ProposalServiceError(400, "Só dá pra criar uma nova a partir de uma proposta recusada");
        }
        base = source;
        parentId = source.id;
      } else {
        base = input.fields;
      }

      const revision = await nextRevision(tx, input.dealId);
      const created = await tx.proposal.create({
        data: {
          organizationId: actor.organizationId,
          dealId: input.dealId,
          revision,
          parentId,
          createdById: actor.userId,
          credit: base.credit,
          termMonths: base.termMonths,
          installment: base.installment,
          quotaCount: base.quotaCount,
          description: base.description,
        },
        select: { id: true },
      });
      // Rascunho não gera linha na timeline (nem edição/exclusão dele) — só
      // entra a partir de "gerou": rascunho abandonado/apagado deixaria uma
      // linha "criou a proposta Nº X" apontando pra algo que não existe mais.
      return reload(tx, created.id);
    });
    if (last.ok || !last.retryable) return last;
  }
  return last!;
}

// ─── Edição (só DRAFT/GENERATED) ────────────────────────────────────────

export async function updateProposal(actor: ProposalActor, id: string, fields: ProposalFields): Promise<ServiceResult<ProposalDTO>> {
  return runTx(actor, async (tx) => {
    const p = await loadInScope(tx, actor, id);
    if (!isProposalEditable(p.status)) {
      throw new ProposalServiceError(409, "Proposta já enviada não pode ser editada — use \"Refazer\" pra criar uma nova revisão.");
    }
    await transition(tx, actor, id, ["DRAFT", "GENERATED"], {
      credit: fields.credit,
      termMonths: fields.termMonths,
      installment: fields.installment,
      quotaCount: fields.quotaCount,
      description: fields.description,
    });
    return reload(tx, id);
  });
}

// ─── Transições de estado ───────────────────────────────────────────────

/** DRAFT → GENERATED. Idempotente em GENERATED (imprimir de novo não muda nada nem duplica a timeline). */
export async function generateProposal(actor: ProposalActor, id: string): Promise<ServiceResult<ProposalDTO>> {
  return runTx(actor, async (tx) => {
    const p = await loadInScope(tx, actor, id);
    if (p.status === "GENERATED") return serializeProposal(p);
    if (p.status !== "DRAFT") {
      throw new ProposalServiceError(409, `Não dá pra gerar uma proposta ${PROPOSAL_STATUS_LABEL[p.status].toLowerCase()}.`);
    }
    await transition(tx, actor, id, ["DRAFT"], { status: "GENERATED", generatedAt: new Date() });
    await logActivity(tx, actor, p, `gerou a ${label(p)}`);
    return reload(tx, id);
  });
}

/** GENERATED → SENT. Declaração explícita do consultor — gerar/imprimir NUNCA marca enviada sozinho (ver Proposal.generatedAt no schema). */
export async function markProposalSent(actor: ProposalActor, id: string): Promise<ServiceResult<ProposalDTO>> {
  return runTx(actor, async (tx) => {
    const p = await loadInScope(tx, actor, id);
    if (p.status === "DRAFT") throw new ProposalServiceError(409, "Gere a proposta antes de marcá-la como enviada.");
    if (p.status !== "GENERATED") {
      throw new ProposalServiceError(409, `Esta proposta já está ${PROPOSAL_STATUS_LABEL[p.status].toLowerCase()}.`);
    }
    await transition(tx, actor, id, ["GENERATED"], { status: "SENT", sentAt: new Date(), sentById: actor.userId });
    await logActivity(tx, actor, p, `marcou a ${label(p)} como enviada · ${formatCurrency(Number(p.credit))}`);
    return reload(tx, id);
  });
}

/** SENT → ACCEPTED | DECLINED. */
export async function resolveProposal(
  actor: ProposalActor,
  id: string,
  outcome: "ACCEPTED" | "DECLINED",
): Promise<ServiceResult<ProposalDTO>> {
  return runTx(actor, async (tx) => {
    const p = await loadInScope(tx, actor, id);
    if (p.status !== "SENT") {
      throw new ProposalServiceError(409, "Só uma proposta enviada pode receber resposta do cliente.");
    }
    await transition(tx, actor, id, ["SENT"], { status: outcome, resolvedAt: new Date() });
    await logActivity(
      tx,
      actor,
      p,
      outcome === "ACCEPTED" ? `registrou que a ${label(p)} foi aceita pelo cliente` : `registrou que a ${label(p)} foi recusada pelo cliente`,
    );
    return reload(tx, id);
  });
}

/**
 * "Refazer": a enviada vira SUPERSEDED (substituída — NÃO recusada: o cliente
 * pediu outra condição, não disse não) e nasce uma revisão nova em DRAFT com
 * os mesmos valores, tudo na mesma transação. O consultor só muda o que
 * precisa em vez de redigitar do zero.
 */
export async function redoProposal(
  actor: ProposalActor,
  id: string,
): Promise<ServiceResult<{ superseded: ProposalDTO; created: ProposalDTO }>> {
  return runTx(actor, async (tx) => {
    const p = await loadInScope(tx, actor, id);
    if (p.status !== "SENT") throw new ProposalServiceError(409, "Só uma proposta enviada pode ser refeita.");

    await transition(tx, actor, id, ["SENT"], { status: "SUPERSEDED", resolvedAt: new Date() });

    const revision = await nextRevision(tx, p.dealId);
    const created = await tx.proposal.create({
      data: {
        organizationId: actor.organizationId,
        dealId: p.dealId,
        revision,
        parentId: p.id,
        createdById: actor.userId,
        credit: p.credit,
        termMonths: p.termMonths,
        installment: p.installment,
        quotaCount: p.quotaCount,
        description: p.description,
      },
      select: { id: true, number: true, revision: true },
    });
    await logActivity(tx, actor, p, `refez a ${label(p)} — nova revisão criada (revisão ${created.revision})`);

    return { superseded: await reload(tx, id), created: await reload(tx, created.id) };
  });
}

/** DRAFT|GENERATED|SENT → CANCELLED. A linha permanece (nunca apaga proposta que já existiu como documento). */
export async function cancelProposal(actor: ProposalActor, id: string): Promise<ServiceResult<ProposalDTO>> {
  return runTx(actor, async (tx) => {
    const p = await loadInScope(tx, actor, id);
    if (p.status === "DRAFT") throw new ProposalServiceError(409, "Rascunho não se cancela — apague.");
    if (p.status !== "GENERATED" && p.status !== "SENT") {
      throw new ProposalServiceError(409, `Esta proposta já está ${PROPOSAL_STATUS_LABEL[p.status].toLowerCase()}.`);
    }
    await transition(tx, actor, id, ["GENERATED", "SENT"], { status: "CANCELLED", resolvedAt: new Date() });
    await logActivity(tx, actor, p, `cancelou a ${label(p)}`);
    return reload(tx, id);
  });
}

/** Só DRAFT. Qualquer outro estado nunca é apagado (ver cancelProposal) — impede maquiar taxa de conversão apagando proposta ruim. */
export async function deleteProposal(actor: ProposalActor, id: string): Promise<ServiceResult<{ id: string }>> {
  return runTx(actor, async (tx) => {
    const p = await loadInScope(tx, actor, id);
    if (p.status !== "DRAFT") {
      throw new ProposalServiceError(409, "Só rascunho pode ser apagado — as demais ficam no histórico (use Cancelar).");
    }
    const result = await tx.proposal.deleteMany({ where: { id, organizationId: actor.organizationId, status: "DRAFT" } });
    if (result.count !== 1) {
      throw new ProposalServiceError(409, "A proposta mudou de estado enquanto você olhava — atualize a página e tente de novo.");
    }
    return { id };
  });
}
