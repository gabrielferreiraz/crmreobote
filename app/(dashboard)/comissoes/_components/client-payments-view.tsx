"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Search, Users } from "lucide-react";
import { Badge } from "@/components/badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Switch } from "@/components/switch";
import { LoadingDots } from "@/components/loading-dots";
import { requestJson } from "@/lib/client-request";
import { formatCurrency } from "@/lib/format";
import { addMonths, formatMonthLong } from "@/lib/commissions/engine";
import { UNPAID_POLICY_EFFECT } from "@/lib/commissions/client-payment";
import { plainSearchText } from "@/lib/commissions/search-text";
import type { ClientPaymentRow } from "@/lib/commissions/queries";

type State = "PAID" | "UNPAID" | "PENDING";

/** O máximo de vendas por chamada (o limite da rota). */
const MARK_BATCH = 500;
type Tab = "pending" | "all" | "unpaid";

/** O ✓ que vale pra linha: marcado à mão, ou débito automático (conta como pago). */
const stateOf = (row: ClientPaymentRow, override?: State): State =>
  override ?? (row.paid === true ? "PAID" : row.paid === false ? "UNPAID" : row.autoDebit ? "PAID" : "PENDING");

/**
 * "Quem pagou a parcela" de um mês — o Financeiro marca com um ✓ quem pagou.
 * A comissão daquele mês só é paga depois do ✓; "não pagou" aplica a regra
 * da administradora (trava, perde ou passa pro mês seguinte) e avisa o
 * vendedor. Débito automático já vem marcado. A tela abre em "Falta
 * conferir" — o que tem trabalho pra fazer.
 */
export function ClientPaymentsView({
  month,
  currentMonth,
  rows,
}: {
  month: string;
  currentMonth: string;
  rows: ClientPaymentRow[];
}) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<Record<string, State>>({});
  // Débito automático trocado aqui (na hora, sem recarregar a tela).
  const [debits, setDebits] = useState<Record<string, boolean>>({});
  const [navigating, startNavigation] = useTransition();
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>("pending");
  const [query, setQuery] = useState("");
  const [bulk, setBulk] = useState<State | null>(null);
  const monthName = formatMonthLong(month).toLowerCase();

  const withState = useMemo(
    () =>
      rows.map((r) => {
        const row = r.saleId in debits ? { ...r, autoDebit: debits[r.saleId] } : r;
        return { ...row, state: stateOf(row, overrides[r.saleId]) };
      }),
    [rows, overrides, debits],
  );
  const counts = {
    pending: withState.filter((r) => r.state === "PENDING").length,
    unpaid: withState.filter((r) => r.state === "UNPAID").length,
    paid: withState.filter((r) => r.state === "PAID").length,
  };
  // Sem acento e sem maiúscula: "joao" acha "João".
  const q = plainSearchText(query);
  const visible = withState.filter(
    (r) =>
      (tab === "all" || (tab === "pending" ? r.state === "PENDING" : r.state === "UNPAID")) &&
      (!q ||
        plainSearchText(r.clientName).includes(q) ||
        plainSearchText(r.sellerName).includes(q) ||
        (r.quotaNumber ?? "").toLowerCase().includes(q) ||
        (r.groupNumber ?? "").toLowerCase().includes(q)),
  );

  async function mark(saleIds: string[], state: State) {
    if (saleIds.length === 0) return;
    const previous = { ...overrides };
    setOverrides((prev) => ({ ...prev, ...Object.fromEntries(saleIds.map((id) => [id, state])) }));
    setBusy((prev) => new Set([...prev, ...saleIds]));
    // Em lotes do tamanho que a rota aceita — "marcar todos" pode passar disso.
    let ok = true;
    for (let i = 0; i < saleIds.length && ok; i += MARK_BATCH) {
      const res = await requestJson("/api/commissions/client-payments", { method: "POST", json: { month, saleIds: saleIds.slice(i, i + MARK_BATCH), state } });
      ok = res.ok;
    }
    setBusy((prev) => {
      const next = new Set(prev);
      saleIds.forEach((id) => next.delete(id));
      return next;
    });
    // Deu certo: a tela já mostra o resultado (nada mais nela muda) — sem
    // recarregar tudo do servidor a cada ✓. Falhou no meio: volta e recarrega,
    // pra mostrar o que já foi gravado.
    if (!ok) {
      setOverrides(previous);
      router.refresh();
    }
  }

  async function setAutoDebit(row: ClientPaymentRow, autoDebit: boolean) {
    setDebits((prev) => ({ ...prev, [row.saleId]: autoDebit }));
    setBusy((prev) => new Set([...prev, row.saleId]));
    const res = await requestJson(`/api/commissions/sales/${row.saleId}`, { method: "PATCH", json: { autoDebit } });
    setBusy((prev) => {
      const next = new Set(prev);
      next.delete(row.saleId);
      return next;
    });
    if (!res.ok) {
      setDebits((prev) => {
        const next = { ...prev };
        delete next[row.saleId];
        return next;
      });
    }
  }

  function goTo(target: string) {
    startNavigation(() => router.push(`/comissoes/clientes?mes=${target}`));
  }

  const pendingIds = withState.filter((r) => r.state === "PENDING").map((r) => r.saleId);
  const total = withState.length;
  const done = total - counts.pending;

  return (
    <div className={`mx-auto max-w-4xl space-y-5 transition-opacity ${navigating ? "pointer-events-none opacity-60" : ""}`} aria-busy={navigating}>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Link href={month === currentMonth ? "/comissoes" : `/comissoes?mes=${month}`} className="icon-btn" aria-label="Voltar para Comissões">
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          </Link>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Quem pagou a parcela</h1>
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Marque com o ✓ os clientes que pagaram a parcela de {monthName}. A comissão do mês só é paga depois disso. Quem está no débito automático já vem
          marcado.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button type="button" className="icon-btn" aria-label="Mês anterior" onClick={() => goTo(addMonths(month, -1))}>
            <ChevronLeft className="h-4 w-4" strokeWidth={2} />
          </button>
          <h2 className="min-w-[11rem] text-center text-lg font-semibold text-neutral-900 dark:text-neutral-100">{formatMonthLong(month)}</h2>
          <button type="button" className="icon-btn" aria-label="Próximo mês" onClick={() => goTo(addMonths(month, 1))}>
            <ChevronRight className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        {total > 0 && (
          <div className="min-w-[14rem] flex-1 space-y-1 sm:max-w-xs">
            <p className="text-sm text-neutral-700 dark:text-neutral-300">
              <strong className="font-semibold text-neutral-900 dark:text-neutral-100">{done} de {total}</strong> conferidos
              {counts.pending > 0 ? `, faltam ${counts.pending}` : " — tudo conferido"}.
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
            </div>
          </div>
        )}
      </div>

      {total === 0 ? (
        <div className="card">
          <EmptyState
            icon={Users}
            title={`Nenhuma venda para conferir em ${monthName}`}
            description=""
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["pending", `Falta conferir (${counts.pending})`],
                  ["unpaid", `Não pagaram (${counts.unpaid})`],
                  ["all", `Todos (${total})`],
                ] as [Tab, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    tab === value
                      ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-neutral-400" strokeWidth={2} />
              <input className="field-input pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Procurar cliente, vendedor ou cota" aria-label="Procurar" />
            </div>
          </div>

          {counts.pending > 0 && tab !== "unpaid" && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-secondary" onClick={() => setBulk("PAID")}>
                <Check className="h-4 w-4" strokeWidth={2.5} />
                Marcar os {counts.pending} que faltam como pagos
              </button>
              <button type="button" className="btn-ghost" onClick={() => setBulk("UNPAID")}>
                Marcar os {counts.pending} que faltam como não pagos
              </button>
            </div>
          )}

          {visible.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={Users}
                title={tab === "pending" ? "Nada falta conferir" : tab === "unpaid" ? "Ninguém deixou de pagar" : "Nada encontrado"}
                description={tab === "pending" ? `Todas as vendas de ${monthName} já foram conferidas.` : undefined}
              />
            </div>
          ) : (
            <ul className="card divide-y divide-neutral-100 p-0 dark:divide-neutral-800">
              {visible.map((row) => {
                const isBusy = busy.has(row.saleId);
                const checked = row.state === "PAID";
                return (
                  <li key={row.saleId} className="flex flex-wrap items-start gap-3 px-4 py-3">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      aria-label={`${row.clientName} pagou a parcela`}
                      disabled={isBusy}
                      // Débito automático sem marca já conta como pago — desmarcar
                      // ele precisa ser "não pagou", senão o ✓ voltaria sozinho.
                      onClick={() => mark([row.saleId], checked ? (row.autoDebit ? "UNPAID" : "PENDING") : "PAID")}
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 transition-colors disabled:opacity-60 ${
                        checked
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : "border-neutral-300 bg-white hover:border-emerald-400 dark:border-neutral-600 dark:bg-neutral-900"
                      }`}
                    >
                      {checked && <Check className="h-5 w-5" strokeWidth={3} />}
                    </button>

                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        {row.clientName}
                        {row.unpaidStreak >= 2 && (
                          <Badge tone={row.unpaidStreak >= 3 ? "danger" : "warning"}>
                            {row.unpaidStreak} meses sem pagar{row.unpaidStreak >= 3 ? " · estorno" : ""}
                          </Badge>
                        )}
                      </p>
                      <p className="text-sm text-neutral-600 dark:text-neutral-400">
                        Vendida por {row.sellerName}
                        {row.administratorName ? `, ${row.administratorName}` : ""}
                        {row.groupNumber ? `, grupo ${row.groupNumber}` : ""}
                        {row.quotaNumber ? `, cota ${row.quotaNumber}` : ""}.
                        {row.clientInstallment != null ? ` Parcela do cliente: ${formatCurrency(row.clientInstallment)}.` : ""}
                      </p>
                      {row.state === "UNPAID" ? (
                        <p className="text-sm font-medium text-red-700 dark:text-red-300">Não pagou · {UNPAID_POLICY_EFFECT[row.policy]}</p>
                      ) : row.state === "PAID" ? (
                        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                          {row.paid === null && row.autoDebit ? "Débito automático" : "Pagou"}
                        </p>
                      ) : (
                        <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Falta conferir</p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <p className="text-sm text-neutral-600 dark:text-neutral-400">
                        <strong className="font-semibold text-neutral-900 tabular-nums dark:text-neutral-100">{formatCurrency(row.commission)}</strong> de comissão
                      </p>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
                          Débito automático
                          <Switch checked={row.autoDebit} disabled={isBusy} onChange={(v) => setAutoDebit(row, v)} label={`${row.clientName} no débito automático`} />
                        </label>
                        {row.state === "UNPAID" ? (
                          <button type="button" className="btn-ghost btn-sm" disabled={isBusy} onClick={() => mark([row.saleId], "PENDING")}>
                            Desfazer
                          </button>
                        ) : (
                          <button type="button" className="btn-ghost btn-sm text-red-600 dark:text-red-400" disabled={isBusy} onClick={() => mark([row.saleId], "UNPAID")}>
                            Não pagou
                          </button>
                        )}
                        {isBusy && <LoadingDots />}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {bulk && (
        <ConfirmDialog
          danger={bulk === "UNPAID"}
          title={bulk === "PAID" ? `Marcar ${counts.pending} como pagos?` : `Marcar ${counts.pending} como não pagos?`}
          description={
            bulk === "PAID"
              ? "As comissões serão liberadas."
              : "A regra de cada administradora será aplicada e os vendedores avisados."
          }
          confirmLabel={bulk === "PAID" ? "Marcar como pagos" : "Marcar como não pagos"}
          onClose={() => setBulk(null)}
          onConfirm={async () => {
            const state = bulk;
            setBulk(null);
            await mark(pendingIds, state);
          }}
        />
      )}
    </div>
  );
}
