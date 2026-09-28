import { NextResponse } from "next/server";
import { updateProposal, deleteProposal } from "@/lib/proposals/service";
import { parseProposalFields } from "@/lib/proposals/validate";
import { withProposalActor, respond } from "@/lib/proposals/route-helpers";
import { bodyErrorResponse, readJson } from "@/lib/read-body";

export const dynamic = "force-dynamic";

/** Edita os campos comerciais — só enquanto DRAFT/GENERATED (a regra em si mora em lib/proposals/service.ts, não aqui). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withProposalActor(async (actor) => {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (err) {
      const response = bodyErrorResponse(err);
      if (response) return response;
      throw err;
    }
    const parsed = parseProposalFields(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    return respond(actor, await updateProposal(actor, id, parsed.value), { mutation: true });
  });
}

/** Só rascunho. Qualquer outro estado devolve 409 e a linha permanece (ver deleteProposal). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withProposalActor(async (actor) => respond(actor, await deleteProposal(actor, id), { mutation: true }));
}
