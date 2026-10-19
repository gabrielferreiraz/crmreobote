import { after } from "next/server";
import { redirect } from "next/navigation";
import { runWithTenant } from "@/lib/tenant-context";
import { getCommissionAccess } from "@/lib/commissions/access";
import { getClientPaymentRows } from "@/lib/commissions/queries";
import { syncOnPageOpen } from "@/lib/commissions/sync";
import { brazilMonthKey, isMonthKey } from "@/lib/commissions/engine";
import { ClientPaymentsView } from "../_components/client-payments-view";

export const dynamic = "force-dynamic";

/** "Quem pagou a parcela" — o ✓ mensal do Financeiro (ver lib/commissions/client-payment.ts). */
export default async function ClientPaymentsPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const access = await getCommissionAccess();
  if (!access.ok) redirect("/");
  if (!access.canManage) redirect("/comissoes");

  // Depois de enviar a tela (rede de segurança pra negócio ganho por um
  // caminho que não sincronizou) — esperar aqui custava ~0,5 s em cada abertura.
  after(() => syncOnPageOpen(access.organizationId, "Quem pagou"));

  const { mes } = await searchParams;
  const currentMonth = brazilMonthKey();
  const month = isMonthKey(mes) ? mes : currentMonth;
  const rows = await runWithTenant(access.organizationId, () => getClientPaymentRows(access.organizationId, month));

  return <ClientPaymentsView key={month} month={month} currentMonth={currentMonth} rows={rows} />;
}
