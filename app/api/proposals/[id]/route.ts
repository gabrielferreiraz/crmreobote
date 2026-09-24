import { NextResponse } from "next/server";
import { updateProposal, deleteProposal } from "@/lib/proposals/service";
import { parseProposalFields } from "@/lib/proposals/validate";
import { withProposalActor, respond } from "@/lib/proposals/route-helpers";

export const dynamic = "force-dynamic";

/** Edita os campos comerciais — só enquanto DRAFT/GENERATED (a regra em si mora em lib/proposals/service.ts, não aqui). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = parseProposalFields(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  return withProposalActor(async (actor) => respond(actor, await updateProposal(actor, id, parsed.value), { mutation: true }));
}

/** Só rascunho. Qualquer outro estado devolve 409 e a linha permanece (ver deleteProposal). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withProposalActor(async (actor) => respond(actor, await deleteProposal(actor, id), { mutation: true }));
}
