import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";
import { runWithTenant } from "@/lib/tenant-context";
import { canBypassRegistration, DOCUMENT_RETENTION_DAYS } from "@/lib/deal-registration/rules";
import { parseRequestItems, summarizeRequestItems } from "@/lib/deal-registration/request-rules";
import { CadastrosList, type CadastroRow } from "./cadastros-list";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cadastros" };

/** Fila do administrativo: vendas ganhas para cadastrar a cota, o que está esperando o consultor e o que já foi feito. */
export default async function CadastrosPage() {
  const m = await getCurrentMembership();
  if (!m?.active || !canBypassRegistration(m)) redirect("/");

  const rows = await runWithTenant(m.organizationId, async () => {
    const deals = await prisma.deal.findMany({
      where: { organizationId: m.organizationId, status: "WON", registration: { isNot: null } },
      orderBy: { closedAt: "desc" },
      take: 400,
      select: {
        id: true,
        value: true,
        grossValue: true,
        closedAt: true,
        contact: { select: { name: true } },
        owner: { select: { name: true } },
        administrator: { select: { name: true } },
        registration: {
          select: {
            completedAt: true,
            waivedReason: true,
            quotaRegisteredAt: true,
            documentsPurgedAt: true,
            documents: { select: { createdAt: true } },
          },
        },
        documentRequests: { orderBy: { createdAt: "desc" }, take: 5, select: { status: true, items: true } },
      },
    });

    return deals.map((d): CadastroRow => {
      const reg = d.registration!;
      const credit = d.grossValue ?? d.value;
      const open = d.documentRequests.find((r) => r.status === "OPEN");
      const last = d.documentRequests[0];
      const base = reg.completedAt ?? d.closedAt;
      const expiries = reg.documents.map((doc) => Math.max(doc.createdAt.getTime(), base ? base.getTime() : 0) + DOCUMENT_RETENTION_DAYS * 86_400_000);
      return {
        id: d.id,
        client: d.contact.name,
        consultant: d.owner.name,
        administrator: d.administrator?.name ?? null,
        credit: credit != null ? Number(credit) : null,
        closedAt: d.closedAt ? d.closedAt.toISOString() : null,
        state: reg.quotaRegisteredAt ? "done" : open ? "waiting" : "ready",
        answered: !reg.quotaRegisteredAt && !open && last?.status === "FULFILLED",
        waitingFor: open ? summarizeRequestItems(parseRequestItems(open.items), 2) : null,
        docs: reg.documents.length,
        docsExpireAt: expiries.length ? new Date(Math.min(...expiries)).toISOString() : null,
        docsPurged: Boolean(reg.documentsPurgedAt),
        waived: Boolean(reg.waivedReason),
        quotaAt: reg.quotaRegisteredAt ? reg.quotaRegisteredAt.toISOString() : null,
      };
    });
  });

  return <CadastrosList rows={rows} />;
}
