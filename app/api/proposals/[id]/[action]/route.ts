import { NextResponse } from "next/server";
import {
  generateProposal,
  markProposalSent,
  resolveProposal,
  redoProposal,
  cancelProposal,
} from "@/lib/proposals/service";
import { withProposalActor, respond } from "@/lib/proposals/route-helpers";

export const dynamic = "force-dynamic";

/**
 * Uma rota por TRANSIÇÃO de estado (não um PATCH genérico com `status` no
 * corpo) — mesmo desenho de POST /api/campaigns/[id]/send-now: cada ação tem
 * regra própria e mensagem de erro própria, e um `status` livre no corpo
 * deixaria o cliente pedir qualquer salto (ex.: DRAFT → ACCEPTED) contando
 * com o servidor lembrar de barrar. Aqui só existe o que a máquina de estados
 * (lib/proposals/service.ts) permite.
 *
 *   generate  DRAFT     → GENERATED   (idempotente em GENERATED)
 *   send      GENERATED → SENT
 *   accept    SENT      → ACCEPTED
 *   decline   SENT      → DECLINED
 *   redo      SENT      → SUPERSEDED + nova revisão em DRAFT (transação única)
 *   cancel    GENERATED|SENT → CANCELLED
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;

  return withProposalActor(async (actor) => {
    switch (action) {
      case "generate":
        return respond(actor, await generateProposal(actor, id), { mutation: true });
      case "send":
        return respond(actor, await markProposalSent(actor, id), { mutation: true });
      case "accept":
        return respond(actor, await resolveProposal(actor, id, "ACCEPTED"), { mutation: true });
      case "decline":
        return respond(actor, await resolveProposal(actor, id, "DECLINED"), { mutation: true });
      case "redo":
        return respond(actor, await redoProposal(actor, id), { mutation: true });
      case "cancel":
        return respond(actor, await cancelProposal(actor, id), { mutation: true });
      default:
        return NextResponse.json({ error: "Ação desconhecida" }, { status: 404 });
    }
  });
}
