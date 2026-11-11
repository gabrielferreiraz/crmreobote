import { NextResponse } from "next/server";
import { z } from "zod";
import { runWithTenant } from "@/lib/tenant-context";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";
import { requireRegistrationAccess } from "@/lib/deal-registration/access";
import { notifyAdministrativeExtraDocuments } from "@/lib/deal-registration/service";
import { getDealAuditLabel } from "@/lib/deal-registration/audit";
import { REGISTRATION_DOC_MAX_FILES } from "@/lib/deal-registration/rules";
import { logAudit } from "@/lib/audit-log";
import { getClientIp, rateLimitOrResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Só vale avisar por arquivos que a própria pessoa acabou de enviar: impede reavisar documentos antigos. */
const RECENT_MS = 60 * 60_000;

const bodySchema = z.object({ documentIds: z.array(z.string().min(1).max(64)).min(1).max(REGISTRATION_DOC_MAX_FILES) }).strict();

/**
 * O consultor terminou de anexar documentos a mais numa venda JÁ ganha (por vontade
 * própria, sem pedido do administrativo): registra o envio na auditoria e avisa o
 * administrativo (tarefa + push). Os arquivos em si já foram enviados pela rota de documentos.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await getCurrentMembership();
  if (!m) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(m.organizationId, async () => {
    const guard = await requireRegistrationAccess(id);
    if ("response" in guard) return guard.response;
    const { access } = guard;

    const limited = rateLimitOrResponse(`deal-extra-docs:${access.userId}`, 20, 10 * 60_000);
    if (limited) return limited;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

    const deal = await prisma.deal.findFirst({ where: { id, organizationId: access.organizationId }, select: { status: true } });
    if (!deal) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    if (deal.status !== "WON") return NextResponse.json({ error: "Só dá para enviar documentos a mais de uma venda já ganha." }, { status: 400 });

    const docs = await prisma.dealRegistrationDocument.findMany({
      where: {
        id: { in: parsed.data.documentIds },
        organizationId: access.organizationId,
        registration: { dealId: id },
        uploadedById: access.userId,
        createdAt: { gt: new Date(Date.now() - RECENT_MS) },
      },
      select: { fileName: true },
      orderBy: { createdAt: "asc" },
    });
    if (docs.length === 0) return NextResponse.json({ error: "Não encontramos arquivos seus enviados agora. Anexe de novo." }, { status: 400 });

    const fileNames = docs.map((d) => d.fileName);
    await logAudit({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      actorName: access.actorName,
      action: "DEAL_REGISTRATION_DOCS_SENT",
      targetType: "Deal",
      targetId: id,
      targetLabel: await getDealAuditLabel(access.organizationId, id),
      detail: `${docs.length === 1 ? "1 documento" : `${docs.length} documentos`}: ${fileNames.slice(0, 5).join(", ")}${docs.length > 5 ? ` e mais ${docs.length - 5}` : ""}`,
      ip: getClientIp(req),
    });

    const { notified } = await notifyAdministrativeExtraDocuments({
      organizationId: access.organizationId,
      dealId: id,
      actor: { userId: access.userId, name: access.actorName },
      fileNames,
    });
    return NextResponse.json({ ok: true, sent: docs.length, notified });
  });
}
