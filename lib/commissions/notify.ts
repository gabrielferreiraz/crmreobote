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

/** O Financeiro marcou que o cliente NÃO pagou a parcela — o vendedor fica sabendo o que acontece com a comissão dele. */
export function notifyClientUnpaid(userId: string, clientName: string, month: string, policy: "HOLD" | "FORFEIT" | "DEFER") {
  const monthName = formatMonthLong(month).toLowerCase();
  const effect =
    policy === "FORFEIT"
      ? "Pela regra da administradora, a comissão dessa parcela não será paga."
      : "Você recebe quando ele pagar — as próximas parcelas andam um mês.";
  return safe("cliente não pagou", () =>
    sendPushToUser(userId, {
      title: `${clientName} não pagou a parcela de ${monthName}`,
      body: effect,
      url: MY_COMMISSION_URL,
    }),
  );
}

/**
 * Vários "não pagou" de uma vez (marcação em lote): UM aviso por vendedor —
 * quem tem 15 clientes na lista não recebe 15 notificações seguidas.
 */
export function notifyClientsUnpaid(items: { userId: string; clientName: string; policy: "HOLD" | "FORFEIT" | "DEFER" }[], month: string) {
  const bySeller = new Map<string, typeof items>();
  for (const item of items) bySeller.set(item.userId, [...(bySeller.get(item.userId) ?? []), item]);
  const monthName = formatMonthLong(month).toLowerCase();
  return Promise.all(
    Array.from(bySeller.entries()).map(([userId, list]) =>
      list.length === 1
        ? notifyClientUnpaid(userId, list[0].clientName, month, list[0].policy)
        : safe("clientes não pagaram", () =>
            sendPushToUser(userId, {
              title: `${list.length} clientes seus não pagaram a parcela de ${monthName}`,
              body: `${list
                .slice(0, 3)
                .map((i) => i.clientName)
                .join(", ")}${list.length > 3 ? " e outros" : ""}. Toque para ver o que acontece com a sua comissão.`,
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
