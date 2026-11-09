import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";
import { runWithTenant } from "@/lib/tenant-context";
import { canBypassRegistration, DOCUMENT_RETENTION_DAYS } from "@/lib/deal-registration/rules";
import { loadRegistrationContext } from "@/lib/deal-registration/service";
import { listDealRequests } from "@/lib/deal-registration/requests";
import { CadastroWorkspace } from "./cadastro-workspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cadastro da cota" };

/** Tela de trabalho do administrativo para uma venda ganha: dados, documentos, cota e pedidos ao consultor. */
export default async function CadastroPage({ params }: { params: Promise<{ id: string }> }) {
  const m = await getCurrentMembership();
  if (!m?.active || !canBypassRegistration(m)) redirect("/");
  const { id } = await params;

  return runWithTenant(m.organizationId, async () => {
    const deal = await prisma.deal.findFirst({
      where: { id, organizationId: m.organizationId },
      select: {
        status: true,
        value: true,
        grossValue: true,
        closedAt: true,
        owner: { select: { name: true } },
        administrator: { select: { name: true } },
      },
    });
    if (!deal) notFound();
    const [ctx, requests] = await Promise.all([loadRegistrationContext(m.organizationId, id), listDealRequests(m.organizationId, id)]);
    if (!ctx) notFound();
    const credit = deal.grossValue ?? deal.value;

    return (
      <CadastroWorkspace
        dealId={id}
        clientName={ctx.contactName}
        consultantName={deal.owner.name}
        administratorName={deal.administrator?.name ?? null}
        credit={credit != null ? Number(credit) : null}
        closedAt={deal.closedAt ? deal.closedAt.toISOString() : null}
        contact={ctx.snapshot.contact as Record<string, string | null>}
        registration={ctx.snapshot.registration as Record<string, string | number | null>}
        documents={ctx.documents.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }))}
        missing={ctx.missing.map((x) => ({ key: x.key, label: x.label }))}
        documentsPurgedAt={ctx.documentsPurgedAt ? ctx.documentsPurgedAt.toISOString() : null}
        completedAt={ctx.completedAt ? ctx.completedAt.toISOString() : null}
        retentionDays={DOCUMENT_RETENTION_DAYS}
        waivedReason={ctx.waivedReason}
        quotaRegisteredAt={ctx.quotaRegisteredAt ? ctx.quotaRegisteredAt.toISOString() : null}
        requests={requests}
      />
    );
  });
}
