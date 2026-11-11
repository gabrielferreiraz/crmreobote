import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { getCurrentMembership } from "@/lib/current-membership";
import { runWithTenant } from "@/lib/tenant-context";
import { canBypassRegistration, DOCUMENT_RETENTION_DAYS, formatQuotaLabel } from "@/lib/deal-registration/rules";
import { parseRequestItems, summarizeRequestItems } from "@/lib/deal-registration/request-rules";
import { getCadastrosSignature } from "@/lib/deal-registration/live";
import { CadastrosList, type CadastroRow } from "./cadastros-list";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cadastros" };

const DONE_LIMIT = 150;

/** Fila do administrativo: vendas ganhas para cadastrar a cota, o que está esperando o consultor e o que já foi feito. */
export default async function CadastrosPage() {
  const m = await getCurrentMembership();
  if (!m?.active || !canBypassRegistration(m)) redirect("/");

  const data = await runWithTenant(m.organizationId, async () => {
    // Antes dos dados: se algo mudar durante a leitura, a próxima consulta da tela percebe a diferença e recarrega.
    const signature = await getCadastrosSignature(m.organizationId);
    const select = {
      id: true,
      ownerId: true,
      administratorId: true,
      value: true,
      grossValue: true,
      closedAt: true,
      contact: { select: { name: true } },
      owner: { select: { name: true } },
      administrator: { select: { name: true } },
      registration: {
        select: {
          completedAt: true,
          holderName: true,
          waivedReason: true,
          quotaRegisteredAt: true,
          groupNumber: true,
          quotaNumber: true,
          quotaDigit: true,
          documentsPurgedAt: true,
          documents: { select: { createdAt: true } },
        },
      },
      documentRequests: { orderBy: { createdAt: "desc" }, take: 5, select: { status: true, items: true } },
    } satisfies Prisma.DealSelect;
    const base = { organizationId: m.organizationId, status: "WON" as const };
    // Pendentes: todas (a fila nunca pode esconder uma venda antiga). Cadastradas: só as mais recentes.
    const [pending, done, doneTotal, consultantRecords, administratorRecords] = await Promise.all([
      prisma.deal.findMany({ where: { ...base, registration: { is: { quotaRegisteredAt: null } } }, orderBy: { closedAt: "desc" }, take: 1500, select }),
      prisma.deal.findMany({
        where: { ...base, registration: { is: { quotaRegisteredAt: { not: null } } } },
        orderBy: { registration: { quotaRegisteredAt: "desc" } },
        take: DONE_LIMIT,
        select,
      }),
      prisma.deal.count({ where: { ...base, registration: { is: { quotaRegisteredAt: { not: null } } } } }),
      prisma.deal.findMany({
        where: base,
        distinct: ["ownerId"],
        select: { ownerId: true, owner: { select: { name: true } } },
      }),
      prisma.deal.findMany({
        where: { ...base, administratorId: { not: null } },
        distinct: ["administratorId"],
        select: { administratorId: true, administrator: { select: { name: true } } },
      }),
    ]);
    const deals = [...pending, ...done];

    const mapped = deals.map((d): CadastroRow => {
      const reg = d.registration!;
      const credit = d.grossValue ?? d.value;
      const open = d.documentRequests.find((r) => r.status === "OPEN");
      const last = d.documentRequests[0];
      const since = reg.completedAt ?? d.closedAt;
      const expiries = reg.documents.map((doc) => Math.max(doc.createdAt.getTime(), since ? since.getTime() : 0) + DOCUMENT_RETENTION_DAYS * 86_400_000);
      return {
        id: d.id,
        client: d.contact.name,
        holderName: reg.holderName?.trim() || d.contact.name,
        quotaLabel: formatQuotaLabel(reg),
        consultant: d.owner.name,
        consultantId: d.ownerId,
        administrator: d.administrator?.name ?? null,
        administratorId: d.administratorId,
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
    return {
      rows: mapped,
      doneTotal,
      signature,
      consultants: consultantRecords.map((item) => ({ id: item.ownerId, name: item.owner.name })),
      administrators: administratorRecords.flatMap((item) => item.administratorId && item.administrator
        ? [{ id: item.administratorId, name: item.administrator.name }]
        : []),
    };
  });

  return <CadastrosList rows={data.rows} doneTotal={data.doneTotal} signature={data.signature} consultants={data.consultants} administrators={data.administrators} />;
}
