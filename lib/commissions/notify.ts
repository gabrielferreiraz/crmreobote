/**
 * Avisos de comissão no celular (push) — o consultor fica sabendo SEM abrir
 * o CRM e sem perguntar no WhatsApp do Financeiro ("quanto eu recebi?" era
 * a dor original do módulo). Tudo aqui é melhor-esforço: nunca derruba a
 * ação que gerou o aviso (chamado de dentro de `after()` nas rotas).
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { sendPushToUser } from "@/lib/push";
import { formatCurrency } from "@/lib/format";
import { formatMonthLong } from "@/lib/commissions/engine";

const MY_COMMISSION_URL = "/comissoes/minha";

function safe(label: string, fn: () => Promise<unknown>) {
  return fn().catch((err) => console.error(`[commissions] falha no aviso: ${label}`, err));
}

/** "Sua comissão foi paga: R$ 3.200,00" — um aviso por pessoa, somando tudo que foi pago na mesma ação. */
export function notifyPaid(entries: { beneficiaryId: string; amount: number; paymentMonth: string }[]) {
  const byPerson = new Map<string, { total: number; months: Set<string> }>();
  for (const e of entries) {
    const current = byPerson.get(e.beneficiaryId) ?? { total: 0, months: new Set<string>() };
    current.total += e.amount;
    current.months.add(e.paymentMonth);
    byPerson.set(e.beneficiaryId, current);
  }
  return Promise.all(
    Array.from(byPerson.entries()).map(([userId, { total, months }]) =>
      safe("paga", () =>
        sendPushToUser(userId, {
          title: `Sua comissão foi paga: ${formatCurrency(total)}`,
          body: months.size === 1 ? `Referente a ${formatMonthLong(Array.from(months)[0]).toLowerCase()}.` : "Toque para ver os detalhes.",
          url: MY_COMMISSION_URL,
        }),
      ),
    ),
  );
}

export function notifyHeld(userId: string, clientName: string | null, reason: string) {
  return safe("travada", () =>
    sendPushToUser(userId, {
      title: "Uma parcela sua foi travada",
      body: `${clientName ? `${clientName}: ` : ""}${reason}`,
      url: MY_COMMISSION_URL,
    }),
  );
}

/**
 * Contestação nova → quem cuida das comissões. Só os marcados em "Cuida das
 * comissões"; se ninguém estiver marcado, os donos (senão ninguém leria).
 */
export function notifyDisputeOpened(organizationId: string, requesterName: string, clientName: string | null) {
  return safe("contestação aberta", async () => {
    const managers = await runWithTenant(organizationId, async () => {
      const marked = await prisma.organizationUser.findMany({
        where: { organizationId, active: true, canManageCommissions: true },
        select: { userId: true },
      });
      if (marked.length > 0) return marked;
      return prisma.organizationUser.findMany({ where: { organizationId, active: true, role: "OWNER" }, select: { userId: true } });
    });
    await Promise.all(
      managers.map((m) =>
        sendPushToUser(m.userId, {
          title: `${requesterName} contestou uma comissão`,
          body: clientName ? `Venda de ${clientName}. Toque para responder.` : "Toque para responder.",
          url: "/comissoes",
        }),
      ),
    );
  });
}

export function notifyDisputeResolved(userId: string, response: string) {
  return safe("contestação respondida", () =>
    sendPushToUser(userId, {
      title: "O Financeiro respondeu sua contestação",
      body: response,
      url: MY_COMMISSION_URL,
    }),
  );
}
