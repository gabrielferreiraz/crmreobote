import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getCurrentMembership } from "@/lib/current-membership";
import { requireRegistrationAccess } from "@/lib/deal-registration/access";
import { getDealAuditLabel } from "@/lib/deal-registration/audit";
import { logAudit } from "@/lib/audit-log";
import { getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Mesma pessoa, mesma coisa, dentro dessa janela = um registro só (abrir o mesmo documento 5 vezes não polui o histórico). */
const THROTTLE_MS = 5 * 60_000;

const bodySchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("doc_viewed"), docId: z.string().min(1).max(64) }).strict(),
  // `what` é só o NOME do dado ("CPF", "Todos os dados do cadastro") — nunca o valor copiado.
  z.object({ event: z.literal("data_copied"), what: z.string().trim().min(1).max(80) }).strict(),
]);

/**
 * Registra o acesso do administrativo a dados sensíveis do cliente: abrir um documento
 * e copiar dados do cadastro. Só quem trabalha no cadastro (Administrativo e Dono); o
 * consultor abrindo o próprio cliente não gera registro. Nunca grava o conteúdo copiado.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await getCurrentMembership();
  if (!m) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(m.organizationId, async () => {
    const guard = await requireRegistrationAccess(id);
    if ("response" in guard) return guard.response;
    const { access } = guard;
    if (!access.canBypass) return NextResponse.json({ ok: true, logged: false });

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

    let action: "DEAL_REGISTRATION_DOC_VIEWED" | "DEAL_DATA_COPIED";
    let detail: string;
    if (parsed.data.event === "doc_viewed") {
      const doc = await prisma.dealRegistrationDocument.findFirst({
        where: { id: parsed.data.docId, organizationId: access.organizationId, registration: { dealId: id } },
        select: { fileName: true },
      });
      if (!doc) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });
      action = "DEAL_REGISTRATION_DOC_VIEWED";
      detail = doc.fileName;
    } else {
      action = "DEAL_DATA_COPIED";
      detail = parsed.data.what.replace(/\s+/g, " ");
    }

    const recent = await prisma.auditLog.findFirst({
      where: {
        organizationId: access.organizationId,
        actorUserId: access.userId,
        action,
        targetType: "Deal",
        targetId: id,
        detail,
        createdAt: { gt: new Date(Date.now() - THROTTLE_MS) },
      },
      select: { id: true },
    });
    if (recent) return NextResponse.json({ ok: true, logged: false });

    await logAudit({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      actorName: access.actorName,
      action,
      targetType: "Deal",
      targetId: id,
      targetLabel: await getDealAuditLabel(access.organizationId, id),
      detail,
      ip: getClientIp(req),
    });
    return NextResponse.json({ ok: true, logged: true });
  });
}
