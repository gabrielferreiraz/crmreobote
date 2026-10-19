"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight, Plus, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { SidePanel } from "@/components/side-panel";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LoadingDots } from "@/components/loading-dots";
import { requestJson } from "@/lib/client-request";
import { formatCurrency } from "@/lib/format";
import { brazilDateKey } from "@/lib/timezone";
import { problemLabel, revenueProblemLabel, ROLE_LABELS } from "@/lib/commissions/engine";
import type { EntryView, SaleListItem } from "@/lib/commissions/queries";
import { EntryRow } from "./entry-row";
import { AdjustmentDialog } from "./adjustment-dialog";
import { SaleFields, saleFormToBody, type SaleFormOptions, type SaleFormState } from "./sale-form";

const SOURCE_SENTENCE = {
  CRM: "Veio do CRM",
  LEGACY: "Venda antiga",
  MANUAL: "Lançada à mão",
} as const;

const formatDay = (iso: string) => brazilDateKey(new Date(iso)).split("-").reverse().join("/");

function toFormState(sale: SaleListItem): SaleFormState {
  return {
    clientName: sale.clientName,
    sellerId: sale.sellerId,
    saleDate: brazilDateKey(new Date(sale.saleDate)),
    administratorId: sale.administratorId ?? "",
    modality: sale.modality,
    netValue: sale.netValue != null ? sale.netValue.toFixed(2) : "",
    grossValue: sale.grossValue != null ? sale.grossValue.toFixed(2) : "",
    clientInstallment: sale.clientInstallment != null ? sale.clientInstallment.toFixed(2) : "",
    autoDebit: sale.autoDebit,
    creditType: sale.creditType ?? "",
    quotaNumber: sale.quotaNumber ?? "",
    groupNumber: sale.groupNumber ?? "",
    notes: sale.notes ?? "",
  };
}

/** O que falta → o que fazer (curto), com atalho quando a solução mora em outra tela. */
function problemHelp(label: string, sale: SaleListItem): { text: string; href?: string; cta?: string } {
  const config = { href: "/comissoes/configuracoes" };
  if (label === revenueProblemLabel("NO_CONFIG")) return { text: "Cadastre quanto a administradora paga", ...config, cta: "Configurar" };
  if (label === revenueProblemLabel("NO_CLIENT_INSTALLMENT")) return { text: "Preencha a parcela do cliente abaixo" };
  if (label === problemLabel({ code: "NO_ADMINISTRATOR" })) return { text: "Escolha a administradora abaixo" };
  if (label === problemLabel({ code: "NO_RULE", role: "SELLER" })) {
    // A regra pode valer só para uma categoria — sem categoria na venda, nenhuma serve.
    return sale.creditType
      ? { text: `Sem regra para ${sale.administratorName ?? "a administradora"}, ${sale.creditType}`, ...config, cta: "Criar regra" }
      : { text: "Escolha a categoria abaixo", ...config, cta: "Ver regras" };
  }
  return { text: `${label.replace(/^Sem /, "Preencha o ")} abaixo` };
}

/** Parcelas por venda, nesta aba do navegador — reabrir/ir e voltar é instantâneo. */
const entriesCache = new Map<string, EntryView[]>();
const inFlight = new Map<string, Promise<EntryView[] | null>>();

/**
 * Busca (e guarda) as parcelas de uma venda. A lista chama ao passar o mouse
 * numa linha, então ao clicar o painel já abre com tudo. `force` ignora o
 * guardado (depois de uma ação, os valores mudaram).
 */
export function fetchSaleEntries(saleId: string, opts?: { force?: boolean }): Promise<EntryView[] | null> {
  if (!opts?.force && entriesCache.has(saleId)) return Promise.resolve(entriesCache.get(saleId)!);
  const pending = inFlight.get(saleId);
  if (pending && !opts?.force) return pending;
  const request = requestJson<{ entries: EntryView[] }>(`/api/commissions/sales/${saleId}`, undefined, { silent: !opts?.force })
    .then((res) => {
      if (!res.ok) return null;
      entriesCache.set(saleId, res.data.entries);
      return res.data.entries;
    })
    .finally(() => inFlight.delete(saleId));
  inFlight.set(saleId, request);
  return request;
}

/**
 * Uma venda inteira, de cima pra baixo na ordem de resolver: de onde veio e
 * em que situação está (uma frase), o que falta pra gerar comissão (com o
 * que fazer), "Confirmar" quando é venda antiga, os dados pra corrigir e
 * quem recebe o quê por ela.
 */
export function SalePanel({
  sale,
  currentMonth,
  options,
  onClose,
  queue = null,
  onNavigate,
}: {
  sale: SaleListItem;
  currentMonth: string;
  options: SaleFormOptions;
  onClose: () => void;
  /** Posição na lista atual — modo fila da conferência ("venda 3 de 157"). */
  queue?: { position: number; total: number; prevId: string | null; nextId: string | null } | null;
  onNavigate?: (saleId: string) => void;
}) {
  const router = useRouter();
  const initial = toFormState(sale);
  const [form, setForm] = useState(initial);
  // Parcelas já vistas (ou buscadas ao passar o mouse na lista) aparecem na
  // hora; a busca abaixo atualiza por cima.
  const [entries, setEntries] = useState<EntryView[] | null>(() => entriesCache.get(sale.id) ?? null);
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);

  const loadEntries = useCallback(async () => {
    const fresh = await fetchSaleEntries(sale.id, { force: true });
    if (fresh) setEntries(fresh);
  }, [sale.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial das parcelas ao abrir o painel
    loadEntries();
  }, [loadEntries]);

  const changes = saleFormToBody(form, initial);
  const dirty = Object.keys(changes).length > 0;
  const cancelled = sale.status === "CANCELLED";
  const hasProblems = sale.problems.length > 0;

  function refreshAll() {
    loadEntries();
    router.refresh();
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await requestJson(`/api/commissions/sales/${sale.id}`, { method: "PATCH", json: changes }, { silent: true });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    refreshAll();
  }

  async function action(name: "confirm" | "cancel" | "reactivate" | "recalculate", then?: "next") {
    setBusyAction(name);
    setError(null);
    const res = await requestJson(`/api/commissions/sales/${sale.id}/${name}`, { method: "POST" }, { silent: true });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (then === "next" && queue?.nextId && onNavigate) {
      onNavigate(queue.nextId);
      router.refresh();
      return;
    }
    refreshAll();
  }

  // Quem recebe por esta venda: uma caixa por pessoa (vendedor, supervisor,
  // gerente — e quem tiver ajuste nela), na ordem vendedor → liderança.
  const people = Array.from(
    (entries ?? [])
      .reduce((map, e) => {
        const person = map.get(e.beneficiaryId) ?? { id: e.beneficiaryId, name: e.beneficiaryName, role: e.role, list: [] as EntryView[] };
        if (e.kind === "INSTALLMENT") person.role = e.role;
        person.list.push(e);
        return map.set(e.beneficiaryId, person);
      }, new Map<string, { id: string; name: string; role: EntryView["role"]; list: EntryView[] }>())
      .values(),
  ).sort((a, b) => ["SELLER", "SUPERVISOR", "MANAGER"].indexOf(a.role) - ["SELLER", "SUPERVISOR", "MANAGER"].indexOf(b.role));

  return (
    <SidePanel title={sale.clientName} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-6">
        {queue && queue.total > 1 && onNavigate && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-neutral-50 px-3 py-2 dark:bg-neutral-800/50">
            <button type="button" className="btn-ghost btn-sm" disabled={!queue.prevId} onClick={() => queue.prevId && onNavigate(queue.prevId)}>
              <ChevronLeft className="h-4 w-4" strokeWidth={2} />
              Anterior
            </button>
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Venda {queue.position} de {queue.total}
            </span>
            <button type="button" className="btn-ghost btn-sm" disabled={!queue.nextId} onClick={() => queue.nextId && onNavigate(queue.nextId)}>
              Próxima
              <ChevronRight className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        )}

        {/* De onde veio */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-0.5 text-sm text-neutral-700 dark:text-neutral-300">
            <p>
              <strong className="font-semibold text-neutral-900 dark:text-neutral-100">{sale.sellerName}</strong> · {formatDay(sale.saleDate)}
            </p>
            <p className="text-neutral-500 dark:text-neutral-400">{SOURCE_SENTENCE[sale.source]}</p>
          </div>
          {sale.dealId && (
            <Link href={`/negocios/${sale.dealId}`} className="btn-secondary btn-sm" target="_blank">
              Negócio
              <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
            </Link>
          )}
        </div>

        {/* Situação */}
        {cancelled && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-500/10">
            <p className="text-sm text-red-900 dark:text-red-100">
              <strong className="font-semibold">Comissão cancelada.</strong> O que já foi pago continua pago.
            </p>
            <button type="button" className="btn-secondary btn-sm" disabled={!!busyAction} onClick={() => action("reactivate")}>
              {busyAction === "reactivate" ? (
                <LoadingDots />
              ) : (
                <>
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
                  Reativar
                </>
              )}
            </button>
          </div>
        )}

        {!cancelled && hasProblems && (
          <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-100">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2} />
              Falta:
            </p>
            <ul className="space-y-1.5 pl-6 text-sm">
              {sale.problems.map((p) => {
                const help = problemHelp(p, sale);
                return (
                  <li key={p} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>• {help.text}</span>
                    {help.href && (
                      <Link href={help.href} className="font-semibold underline underline-offset-2">
                        {help.cta}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {sale.status === "REVIEW" && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/20 bg-brand-light px-4 py-3">
            <p className="text-sm text-neutral-800 dark:text-neutral-200">
              {hasProblems
                ? "Resolva o que falta para confirmar."
                : dirty
                  ? "Salve antes de confirmar."
                  : "Ao confirmar, o vendedor passa a ver."}
            </p>
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={!!busyAction || dirty || hasProblems}
              onClick={() => action("confirm", queue?.nextId ? "next" : undefined)}
            >
              {busyAction === "confirm" ? (
                <LoadingDots />
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
                  {queue?.nextId ? "Confirmar e próxima" : "Confirmar"}
                </>
              )}
            </button>
          </div>
        )}

        {/* Quanto fica para a corretora */}
        {!cancelled && (sale.revenueTotal != null || sale.commissionTotal > 0) && (
          <section className="space-y-1.5 rounded-xl border border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Saldo da corretora</h3>
            {sale.revenueTotal != null ? (
              <dl className="space-y-1 text-sm text-neutral-700 dark:text-neutral-300">
                <div className="flex justify-between gap-3">
                  <dt>{sale.administratorName ?? "Administradora"} paga</dt>
                  <dd className="tabular-nums">{formatCurrency(sale.revenueTotal)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Comissões da empresa</dt>
                  <dd className="tabular-nums">− {formatCurrency(sale.commissionPaidByCompany)}</dd>
                </div>
                {sale.commissionTotal > sale.commissionPaidByCompany && (
                  <div className="flex justify-between gap-3 text-neutral-500 dark:text-neutral-400">
                    <dt>Pago direto pela administradora</dt>
                    <dd className="tabular-nums">{formatCurrency(sale.commissionTotal - sale.commissionPaidByCompany)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3 border-t border-neutral-100 pt-1 text-base font-semibold text-neutral-900 dark:border-neutral-800 dark:text-neutral-100">
                  <dt>Fica</dt>
                  <dd className="tabular-nums">{formatCurrency(sale.revenueTotal - sale.commissionPaidByCompany)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Comissão: {formatCurrency(sale.commissionTotal)}.{" "}
                {sale.administratorId ? (
                  <Link href="/comissoes/configuracoes" className="font-semibold text-brand underline underline-offset-2">
                    Cadastrar quanto a {sale.administratorName} paga
                  </Link>
                ) : null}
              </p>
            )}
          </section>
        )}

        {/* Dados da venda */}
        {!cancelled && (
          <section className="space-y-3">
            <div>
              <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Dados da venda</h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">Parcelas não pagas são recalculadas ao salvar.</p>
            </div>
            <SaleFields value={form} onChange={setForm} options={options} showClient={sale.source === "MANUAL"} />
            {dirty && (
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={() => setForm(initial)} disabled={saving}>
                  Desfazer mudanças
                </button>
                <button type="button" className="btn-primary" onClick={save} disabled={saving}>
                  {saving ? <LoadingDots /> : "Salvar correções"}
                </button>
              </div>
            )}
          </section>
        )}

        {error && <p className="field-error text-sm">{error}</p>}

        {/* Quem recebe */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Quem recebe</h3>
            {!cancelled && (
              <button type="button" className="btn-secondary btn-sm" onClick={() => setAdjustmentOpen(true)}>
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                Ajuste
              </button>
            )}
          </div>
          {entries === null ? (
            <p className="flex items-center gap-2 py-4 text-sm text-neutral-500">
              Carregando <LoadingDots />
            </p>
          ) : people.length === 0 ? (
            <p className="rounded-xl bg-neutral-50 px-4 py-4 text-sm text-neutral-600 dark:bg-neutral-800/50 dark:text-neutral-400">
              {hasProblems ? "Sem parcelas até resolver o que falta." : "Sem parcelas."}
            </p>
          ) : (
            people.map((person) => {
              const total = person.list.filter((e) => e.status !== "CANCELLED").reduce((acc, e) => acc + e.amount, 0);
              return (
                <div key={person.id} className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-100 bg-neutral-50 px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-800/40">
                    <p className="text-sm text-neutral-800 dark:text-neutral-200">
                      <strong className="font-semibold">{person.name}</strong> · {ROLE_LABELS[person.role].toLowerCase()}
                    </p>
                    <p className="text-sm font-semibold text-neutral-900 tabular-nums dark:text-neutral-100">{formatCurrency(total)}</p>
                  </div>
                  <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {person.list.map((entry) => (
                      <EntryRow key={entry.id} entry={entry} currentMonth={currentMonth} show="person" onChanged={refreshAll} />
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </section>

        {!cancelled && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-4 dark:border-neutral-800">
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={!!busyAction || dirty}
              onClick={() => action("recalculate")}
              title="Refaz as parcelas não pagas com as regras atuais"
            >
              {busyAction === "recalculate" ? (
                <LoadingDots />
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
                  Recalcular
                </>
              )}
            </button>
            <button type="button" className="btn-ghost btn-sm text-red-600 dark:text-red-400" disabled={!!busyAction} onClick={() => setConfirmCancel(true)}>
              <XCircle className="h-3.5 w-3.5" strokeWidth={2} />
              Cancelar comissão
            </button>
          </div>
        )}
      </div>

      {confirmCancel && (
        <ConfirmDialog
          title="Cancelar a comissão?"
          description="O que já foi pago continua pago. O resto é cancelado."
          confirmLabel="Cancelar comissão"
          closeLabel="Voltar"
          onClose={() => setConfirmCancel(false)}
          onConfirm={async () => {
            await action("cancel");
            setConfirmCancel(false);
          }}
        />
      )}
      {adjustmentOpen && (
        <AdjustmentDialog
          members={options.members}
          currentMonth={currentMonth}
          defaultBeneficiaryId={sale.sellerId}
          saleId={sale.id}
          onClose={() => setAdjustmentOpen(false)}
          onSaved={() => {
            setAdjustmentOpen(false);
            refreshAll();
          }}
        />
      )}
    </SidePanel>
  );
}
