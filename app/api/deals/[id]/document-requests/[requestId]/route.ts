import { NextResponse } from "next/server";
import { z } from "zod";
import { runWithTenant } from "@/lib/tenant-context";
import { getCurrentMembership } from "@/lib/current-membership";
import { requireRegistrationAccess } from "@/lib/deal-registration/access";
import { REQUEST_NOTE_MAX } from "@/lib/deal-registration/request-rules";
import { DocumentRequestError, cancelDocumentRequest, completeRequestItem } from "@/lib/deal-registration/requests";

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("complete_item"),
      itemKey: z.string().trim().min(1).max(60),
      documentIds: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
      note: z.string().trim().max(REQUEST_NOTE_MAX).nullable().optional(),
    })
    .strict(),
  z.object({ action: z.literal("cancel") }).strict(),
]);

/** Atende um item do pedido (consultor ou administrativo) ou cancela o pedido (só administrativo). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  const { id, requestId } = await params;
  const m = await getCurrentMembership();
  if (!m) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(m.organizationId, async () => {
    const guard = await requireRegistrationAccess(id);
    if ("response" in guard) return guard.response;
    const { access } = guard;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
    const actor = { userId: access.userId, name: access.actorName };

    try {
      if (parsed.data.action === "cancel") {
        if (!access.canBypass) return NextResponse.json({ error: "Só o administrativo cancela um pedido." }, { status: 403 });
        const request = await cancelDocumentRequest({ organizationId: access.organizationId, dealId: id, requestId, actor });
        return NextResponse.json({ request });
      }
      const result = await completeRequestItem({
        organizationId: access.organizationId,
        dealId: id,
        requestId,
        itemKey: parsed.data.itemKey,
        actor,
        documentIds: parsed.data.documentIds,
        note: parsed.data.note,
      });
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof DocumentRequestError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  });
}
