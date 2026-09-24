import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { scopeWhere } from "@/lib/team-scope";
import { listProposalsForDeal } from "@/lib/proposals/queries";
import { createProposal } from "@/lib/proposals/service";
import { parseProposalFields } from "@/lib/proposals/validate";
import { withProposalActor, respond } from "@/lib/proposals/route-helpers";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return withProposalActor(async (actor) => {
    const deal = await prisma.deal.findFirst({
      where: { id, organizationId: actor.organizationId, ...scopeWhere(actor.scope) },
      select: { id: true },
    });
    if (!deal) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    return NextResponse.json(await listProposalsForDeal(actor.organizationId, id));
  });
}

/**
 * Cria uma proposta em rascunho no negócio. Dois formatos de corpo:
 *  - `{ credit, termMonths, installment, quotaCount, description }` — proposta nova.
 *  - `{ fromProposalId }` — nova a partir de uma RECUSADA (copia os valores).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Corpo inválido" }, { status: 400 });

  return withProposalActor(async (actor) => {
    const { fromProposalId } = body as { fromProposalId?: unknown };
    if (typeof fromProposalId === "string" && fromProposalId) {
      return respond(actor, await createProposal(actor, { dealId: id, fromProposalId }), { status: 201, mutation: true });
    }

    const parsed = parseProposalFields(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    return respond(actor, await createProposal(actor, { dealId: id, fields: parsed.value }), { status: 201, mutation: true });
  });
}
