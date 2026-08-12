import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { notifyMetaLeadQualification } from "@/lib/meta-ads/conversions";
import { recordUserChange } from "@/lib/user-activity";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { qualification } = body as { qualification: "QUALIFIED" | "UNQUALIFIED" | null };

  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  if (qualification !== null && qualification !== "QUALIFIED" && qualification !== "UNQUALIFIED") {
    return NextResponse.json({ error: "Qualificação inválida" }, { status: 400 });
  }

  return runWithTenant(organizationId, async () => {
    const existing = await prisma.contact.findFirst({
      where: { id, organizationId },
      select: { id: true, email: true, phone: true, whatsapp: true, leadQualification: true },
    });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const previousQualification = existing.leadQualification;

    const updated = await prisma.contact.update({
      where: { id },
      data: {
        leadQualification: qualification,
        leadQualificationAt: qualification ? new Date() : null,
        leadQualificationBy: qualification ? userId : null,
      },
    });

    // Só manda pro Conversions API na transição PARA "QUALIFIED" — nem em
    // reset (qualification === null), nem em "UNQUALIFIED" (esse fica só no
    // relatório interno, ver lib/meta-ads/attribution.ts; não existe evento
    // de "lead ruim" pra mandar pra Meta, e reenviar "Lead" ali só
    // ensinaria o algoritmo a otimizar pra mais gente parecida com quem a
    // gente não quer). E só se REALMENTE mudou (evita spam de eventos
    // repetidos no Meta Ads Manager ao salvar o mesmo status de novo).
    if (qualification === "QUALIFIED" && previousQualification !== "QUALIFIED") {
      notifyMetaLeadQualification(organizationId, {
        id: existing.id,
        email: existing.email,
        phone: existing.phone,
        whatsapp: existing.whatsapp,
      }).catch((err) => console.error("[meta-ads] falha ao enviar evento de qualificação de lead", err));
    }

    recordUserChange(organizationId, userId).catch((err) =>
      console.error("[user-activity] falha ao registrar alteração", err),
    );

    return NextResponse.json({
      leadQualification: updated.leadQualification,
      leadQualificationAt: updated.leadQualificationAt,
      leadQualificationBy: updated.leadQualificationBy,
    });
  });
}
