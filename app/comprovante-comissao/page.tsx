import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getCommissionAccess, sellerVisibleFromMonth } from "@/lib/commissions/access";
import { getMyCommissionEntries } from "@/lib/commissions/queries";
import { formatMonthLong, isMonthKey, ROLE_LABELS } from "@/lib/commissions/engine";
import { entryWhat } from "@/lib/commissions/ui";
import { formatCurrency } from "@/lib/format";
import { brazilDateTime } from "@/lib/timezone";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Comprovante de comissão" };

const STATUS_LABEL = { SCHEDULED: "A receber", ON_HOLD: "Travada", PAID: "Paga", CANCELLED: "Cancelada" } as const;

/**
 * Comprovante de comissão de UM mês, pronto pra "Salvar como PDF" — FORA de
 * (dashboard) de propósito (mesmo desenho de app/propostas/[id]): o
 * documento nasce sem menu nem cabeçalho do CRM. Rota autenticada: o
 * consultor só abre o PRÓPRIO comprovante (e só de mês que ele enxerga na
 * "Minha comissão"); quem cuida das comissões pode abrir o de qualquer
 * pessoa com `pessoa=<id>`.
 */
export default async function CommissionReceiptPage({ searchParams }: { searchParams: Promise<{ mes?: string; pessoa?: string }> }) {
  const access = await getCommissionAccess();
  if (!access.ok) redirect("/login");

  const { mes, pessoa } = await searchParams;
  if (!isMonthKey(mes)) redirect("/comissoes");
  const userId = access.canManage && pessoa ? pessoa : access.userId;

  const data = await runWithTenant(access.organizationId, async () => {
    const [org, person] = await Promise.all([
      prisma.organization.findUnique({ where: { id: access.organizationId }, select: { name: true, commissionSellerPastMonths: true, commissionPayDay: true } }),
      prisma.organizationUser.findUnique({
        where: { organizationId_userId: { organizationId: access.organizationId, userId } },
        select: { user: { select: { name: true, company: { select: { name: true, cnpj: true } } } } },
      }),
    ]);
    if (!person) return null;
    const fromMonth = access.canManage ? "0000-01" : sellerVisibleFromMonth(org?.commissionSellerPastMonths ?? 0);
    if (mes < fromMonth) return null;
    const entries = (await getMyCommissionEntries(access.organizationId, userId, fromMonth)).filter((e) => e.paymentMonth === mes);
    return { org, person, entries };
  });
  if (!data) redirect("/comissoes");

  const { org, person, entries } = data;
  const counted = entries.filter((e) => e.status !== "ON_HOLD");
  const total = counted.reduce((acc, e) => acc + e.amount, 0);
  const paid = entries.filter((e) => e.status === "PAID").reduce((acc, e) => acc + e.amount, 0);
  const held = entries.filter((e) => e.status === "ON_HOLD").reduce((acc, e) => acc + e.amount, 0);

  return (
    <div className="min-h-dvh bg-neutral-100 py-8 text-neutral-900 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-3xl justify-end px-4 print:hidden">
        <PrintButton />
      </div>
      <main className="mx-auto max-w-3xl bg-white px-10 py-10 shadow-sm print:max-w-none print:px-0 print:py-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b-2 border-neutral-300 pb-4">
          <div>
            <p className="text-sm text-neutral-500">{org?.name}</p>
            <h1 className="text-2xl font-semibold">Comprovante de comissão</h1>
            <p className="mt-1 text-base">{formatMonthLong(mes)}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">{person.user.name}</p>
            {person.user.company && <p className="text-neutral-600">{person.user.company.name}</p>}
          </div>
        </header>

        {entries.length === 0 ? (
          <p className="py-10 text-center text-neutral-500">Nenhuma comissão neste mês.</p>
        ) : (
          <table className="mt-6 w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-300 text-left text-neutral-600">
                <th className="py-2 pr-3 font-medium">Cliente</th>
                <th className="py-2 pr-3 font-medium">Administradora</th>
                <th className="py-2 pr-3 font-medium">Parcela</th>
                <th className="py-2 pr-3 font-medium">Situação</th>
                <th className="py-2 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-neutral-100 align-top">
                  <td className="py-2 pr-3">
                    {e.kind === "ADJUSTMENT" ? `Ajuste: ${e.note ?? ""}` : e.clientName}
                    {e.role !== "SELLER" && <span className="text-neutral-500"> (como {ROLE_LABELS[e.role].toLowerCase()})</span>}
                  </td>
                  <td className="py-2 pr-3">{e.administratorName ?? "—"}</td>
                  <td className="py-2 pr-3">{e.kind === "ADJUSTMENT" ? "—" : entryWhat(e)}</td>
                  <td className="py-2 pr-3">
                    {e.paidByAdministrator && e.status !== "PAID" ? "Paga pela administradora" : STATUS_LABEL[e.status]}
                    {e.status === "ON_HOLD" && e.holdReason ? <span className="block text-sm text-neutral-600">Motivo: {e.holdReason}</span> : null}
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatCurrency(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <section className="mt-6 ml-auto w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between border-t-2 border-neutral-300 pt-2 text-base font-semibold">
            <span>Total do mês</span>
            <span className="tabular-nums">{formatCurrency(total)}</span>
          </div>
          <div className="flex justify-between text-neutral-600">
            <span>Já pago</span>
            <span className="tabular-nums">{formatCurrency(paid)}</span>
          </div>
          {held > 0 && (
            <div className="flex justify-between text-neutral-600">
              <span>Travado (fora do total)</span>
              <span className="tabular-nums">{formatCurrency(held)}</span>
            </div>
          )}
        </section>

        <footer className="mt-10 border-t border-neutral-200 pt-3 text-xs text-neutral-500">
          Pagamento todo dia {org?.commissionPayDay ?? 10}. Gerado em {brazilDateTime(new Date())}.
        </footer>
      </main>
    </div>
  );
}
