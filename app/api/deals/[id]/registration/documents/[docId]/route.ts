import { NextResponse } from "next/server";
import { runWithTenant } from "@/lib/tenant-context";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";
import { requireRegistrationAccess } from "@/lib/deal-registration/access";
import { deleteRegistrationDoc, getRegistrationDocObject, isRegistrationDocKey } from "@/lib/r2";
import { logAudit } from "@/lib/audit-log";
import { getClientIp } from "@/lib/rate-limit";
import { getDealAuditLabel } from "@/lib/deal-registration/audit";

export const dynamic = "force-dynamic";

async function findDocument(organizationId: string, dealId: string, docId: string) {
  return prisma.dealRegistrationDocument.findFirst({
    where: { id: docId, organizationId, registration: { dealId } },
    select: { id: true, fileName: true, contentType: true, storageKey: true, registration: { select: { completedAt: true } } },
  });
}

/** Entrega o arquivo — só para quem tem acesso ao cadastro; nunca há link público. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  const m = await getCurrentMembership();
  if (!m) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(m.organizationId, async () => {
    const guard = await requireRegistrationAccess(id);
    if ("response" in guard) return guard.response;
    const { access } = guard;

    const doc = await findDocument(access.organizationId, id, docId);
    if (!doc || !isRegistrationDocKey(doc.storageKey, access.organizationId)) {
      return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });
    }
    const object = await getRegistrationDocObject(doc.storageKey);
    if (!object) return NextResponse.json({ error: "Arquivo indisponível" }, { status: 404 });

    const isDownload = new URL(req.url).searchParams.get("download") === "1";
    // Miniatura e visualização inline carregam a mesma rota, mas não são
    // download. Registrar esses GETs poluía o histórico a cada renderização.
    if (isDownload && access.userId !== access.deal.ownerId) {
      void logAudit({
        organizationId: access.organizationId,
        actorUserId: access.userId,
        actorName: access.actorName,
        action: "DEAL_REGISTRATION_DOC_DOWNLOADED",
        targetType: "Deal",
        targetId: id,
        targetLabel: await getDealAuditLabel(access.organizationId, id),
        detail: doc.fileName,
        ip: getClientIp(req),
      });
    }
    const safeName = doc.fileName.replace(/[^\w.\- ]+/g, "_");
    return new NextResponse(Buffer.from(object.body), {
      headers: {
        "Content-Type": doc.contentType,
        "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename="${safeName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  const m = await getCurrentMembership();
  if (!m) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(m.organizationId, async () => {
    const guard = await requireRegistrationAccess(id);
    if ("response" in guard) return guard.response;
    const { access } = guard;

    const doc = await findDocument(access.organizationId, id, docId);
    if (!doc) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });
    // Depois do Ganho o documento é da administradora/administrativo: o consultor não apaga.
    if (doc.registration.completedAt && !access.canBypass) {
      return NextResponse.json({ error: "O Ganho já foi concluído. Peça ao administrativo para trocar o documento." }, { status: 403 });
    }

    await prisma.dealRegistrationDocument.delete({ where: { id: doc.id } });
    if (isRegistrationDocKey(doc.storageKey, access.organizationId)) await deleteRegistrationDoc(doc.storageKey).catch(() => {});
    void logAudit({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      actorName: access.actorName,
      action: "DEAL_REGISTRATION_DOC_DELETED",
      targetType: "Deal",
      targetId: id,
      targetLabel: await getDealAuditLabel(access.organizationId, id),
      detail: doc.fileName,
      ip: getClientIp(req),
    });
    return NextResponse.json({ ok: true });
  });
}
