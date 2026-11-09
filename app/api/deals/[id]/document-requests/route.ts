import { NextResponse } from "next/server";
import { z } from "zod";
import { runWithTenant } from "@/lib/tenant-context";
import { getCurrentMembership } from "@/lib/current-membership";
import { requireRegistrationAccess } from "@/lib/deal-registration/access";
import { REQUEST_LABEL_MAX, REQUEST_MAX_ITEMS, REQUEST_MESSAGE_MAX } from "@/lib/deal-registration/request-rules";
import { DocumentRequestError, createDocumentRequest, listDealRequests } from "@/lib/deal-registration/requests";
import { rateLimitOrResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const createSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            key: z.string().trim().min(1).max(60),
            label: z.string().trim().max(REQUEST_LABEL_MAX).optional(),
          })
          .strict(),
      )
      .min(1, "Escolha pelo menos um item para pedir.")
      .max(REQUEST_MAX_ITEMS),
    message: z.string().trim().max(REQUEST_MESSAGE_MAX).nullable().optional(),
  })
  .strict();

/** Pedidos do negócio: o administrativo e o consultor envolvido enxergam. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await getCurrentMembership();
  if (!m) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(m.organizationId, async () => {
    const guard = await requireRegistrationAccess(id);
    if ("response" in guard) return guard.response;
    const requests = await listDealRequests(guard.access.organizationId, id);
    return NextResponse.json({ requests, canRequest: guard.access.canBypass });
  });
}

/** O administrativo (ou o Dono) pede documentos/correções ao consultor. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await getCurrentMembership();
  if (!m) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(m.organizationId, async () => {
    const guard = await requireRegistrationAccess(id);
    if ("response" in guard) return guard.response;
    const { access } = guard;
    if (!access.canBypass) return NextResponse.json({ error: "Só o administrativo pede documentos ao consultor." }, { status: 403 });

    const limited = rateLimitOrResponse(`deal-document-request:${access.userId}`, 30, 10 * 60_000);
    if (limited) return limited;

    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

    try {
      const request = await createDocumentRequest({
        organizationId: access.organizationId,
        dealId: id,
        actor: { userId: access.userId, name: access.actorName },
        items: parsed.data.items,
        message: parsed.data.message,
      });
      return NextResponse.json({ request }, { status: 201 });
    } catch (err) {
      if (err instanceof DocumentRequestError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  });
}
