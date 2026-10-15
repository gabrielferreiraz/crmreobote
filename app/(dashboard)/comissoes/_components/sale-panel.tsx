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
import { ROLE_LABELS } from "@/lib/commissions/engine";
import type { EntryView, SaleListItem } from "@/lib/commissions/queries";
import { EntryRow } from "./entry-row";
import { AdjustmentDialog } from "./adjustment-dialog";
import { SaleFields, saleFormToBody, type SaleFormOptions, type SaleFormState } from "./sale-form";

const SOURCE_SENTENCE = {
  CRM: "Veio do CRM quando o negócio foi marcado como ganho.",
  LEGACY: "Venda antiga, trazida do CRM para conferência.",
  MANUAL: "Lançada à mão pelo Financeiro (não está no CRM).",
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
    creditType: sale.creditType ?? "",
    quotaNumber: sale.quotaNumber ?? "",
    groupNumber: sale.groupNumber ?? "",
    notes: sale.notes ?? "",
  };
}

/** O que falta, traduzido em "o que fazer" — com o atalho certo quando a solução mora em outra tela. */
function problemHelp(label: string): { text: string; href?: string; cta?: string } {
  // Ordem importa: "quanto a administradora paga" também contém "administradora".
  if (label.includes("paga para a corretora")) {
    return { text: "Cadastrar quanto a administradora paga para a corretora (a regra deste vendedor depende disso).", href: "/comissoes/configuracoes", cta: "Configurar" };
  }
  if (label.includes("parcela do cliente")) return { text: "Preencher o valor da parcela que o cliente paga, logo abaixo em Dados da venda." };
  if (label.includes("valor da venda")) return { text: "Preencher o valor da venda, logo abaixo." };
  if (label.includes("administradora")) return { text: "Escolher a administradora, logo abaixo em Dados da venda." };
  if (label.includes("regra")) return { text: "Criar uma regra que diga quanto o vendedor ganha nessa administradora.", href: "/comissoes/configuracoes", cta: "Criar regra" };
  if (label.includes("bruto")) return { text: "Preencher o valor bruto da venda, logo abaixo." };
  if (label.includes("líquido")) return { text: "Preencher o valor líquido da venda, logo abaixo." };
  return { text: label };
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
  const [entries, setEntries] = useState<EntryView[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);

  const loadEntries = useCallback(async () => {
    const res = await requestJson<{ entries: EntryView[] }>(`/api/commissions/sales/${sale.id}`);
    if (res.ok) setEntries(res.data.entries);
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
              Vendida por <strong className="font-semibold text-neutral-900 dark:text-neutral-100">{sale.sellerName}</strong> em {formatDay(sale.saleDate)}.
            </p>
            <p className="text-neutral-500 dark:text-neutral-400">{SOURCE_SENTENCE[sale.source]}</p>
          </div>
          {sale.dealId && (
            <Link href={`/negocios/${sale.dealId}`} className="btn-secondary btn-sm" target="_blank">
              Abrir o negócio
              <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
            </Link>
          )}
        </div>

        {/* Situação */}
        {cancelled && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-500/10">
            <p className="text-sm text-red-900 dark:text-red-100">
              <strong className="font-semibold">A comissão desta venda está cancelada.</strong> O que já tinha sido pago continua pago; o resto não
              será pago.
            </p>
            <button type="button" className="btn-secondary btn-sm" disabled={!!busyAction} onClick={() => action("reactivate")}>
              {busyAction === "reactivate" ? (
                <LoadingDots />
              ) : (
                <>
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
                  Voltar a pagar
                </>
              )}
            </button>
          </div>
        )}

        {!cancelled && hasProblems && (
          <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-100">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2} />
              Para esta venda gerar comissão, falta:
            </p>
            <ul className="space-y-1.5 pl-6 text-sm">
              {sale.problems.map((p) => {
                const help = problemHelp(p);
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
                ? "Resolva o que falta acima para poder confirmar."
                : dirty
                  ? "Salve as correções antes de confirmar."
                  : "Está tudo certo? Ao confirmar, o vendedor passa a ver esta comissão."}
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
                  {queue?.nextId ? "Confirmar e ir para a próxima" : "Confirmar venda"}
                </>
              )}
            </button>
          </div>
        )}

        {/* Quanto fica para a corretora */}
        {!cancelled && (sale.revenueTotal != null || sale.commissionTotal > 0) && (
          <section className="space-y-1.5 rounded-xl border border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Quanto fica para a corretora</h3>
            {sale.revenueTotal != null ? (
              <>
                <p className="text-sm text-neutral-700 dark:text-neutral-300">
                  {sale.administratorName ?? "A administradora"} paga <strong className="font-semibold">{formatCurrency(sale.revenueTotal)}</strong> para a
                  corretora por esta venda.
                </p>
                <p className="text-sm text-neutral-700 dark:text-neutral-300">
                  A corretora paga <strong className="font-semibold">{formatCurrency(sale.commissionPaidByCompany)}</strong> de comissão
                  {sale.commissionTotal > sale.commissionPaidByCompany
                    ? ` (mais ${formatCurrency(sale.commissionTotal - sale.commissionPaidByCompany)} que a administradora paga direto ao vendedor)`
                    : ""}
                  .
                </p>
                <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                  Ficam {formatCurrency(sale.revenueTotal - sale.commissionPaidByCompany)} para a corretora.
                </p>
              </>
            ) : (
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                A comissão desta venda é de {formatCurrency(sale.commissionTotal)}. Para ver quanto fica para a corretora,{" "}
                {sale.administratorId ? (
                  <>
                    cadastre quanto a {sale.administratorName} paga em{" "}
                    <Link href="/comissoes/configuracoes" className="font-semibold text-brand underline underline-offset-2">
                      Configurar comissões
                    </Link>
                    {" "}(ou preencha o valor da parcela do cliente, se ela pagar por ele).
                  </>
                ) : (
                  "escolha a administradora."
                )}
              </p>
            )}
          </section>
        )}

        {/* Dados da venda */}
        {!cancelled && (
          <section className="space-y-3">
            <div>
              <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Dados da venda</h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Corrija aqui o que veio errado. As parcelas que ainda não foram pagas são recalculadas na hora; o negócio no CRM não muda.
              </p>
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
            <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Quem recebe por esta venda</h3>
            {!cancelled && (
              <button type="button" className="btn-secondary btn-sm" onClick={() => setAdjustmentOpen(true)}>
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                Lançar ajuste nesta venda
              </button>
            )}
          </div>
          {entries === null ? (
            <p className="flex items-center gap-2 py-4 text-sm text-neutral-500">
              Carregando as parcelas <LoadingDots />
            </p>
          ) : people.length === 0 ? (
            <p className="rounded-xl bg-neutral-50 px-4 py-4 text-sm text-neutral-600 dark:bg-neutral-800/50 dark:text-neutral-400">
              {hasProblems ? "Ninguém recebe ainda — resolva o que falta acima." : "Nenhuma parcela nesta venda."}
            </p>
          ) : (
            people.map((person) => {
              const total = person.list.filter((e) => e.status !== "CANCELLED").reduce((acc, e) => acc + e.amount, 0);
              return (
                <div key={person.id} className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-100 bg-neutral-50 px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-800/40">
                    <p className="text-sm text-neutral-800 dark:text-neutral-200">
                      <strong className="font-semibold">{person.name}</strong> recebe como {ROLE_LABELS[person.role].toLowerCase()}
                    </p>
                    <p className="text-sm font-semibold text-neutral-900 tabular-nums dark:text-neutral-100">{formatCurrency(total)} no total</p>
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
              title="Refaz as parcelas que ainda não foram pagas com as regras e a administradora de hoje"
            >
              {busyAction === "recalculate" ? (
                <LoadingDots />
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
                  Refazer com as regras de hoje
                </>
              )}
            </button>
            <button type="button" className="btn-ghost btn-sm text-red-600 dark:text-red-400" disabled={!!busyAction} onClick={() => setConfirmCancel(true)}>
              <XCircle className="h-3.5 w-3.5" strokeWidth={2} />
              Cancelar a comissão desta venda
            </button>
          </div>
        )}
      </div>

      {confirmCancel && (
        <ConfirmDialog
          title="Cancelar a comissão desta venda?"
          description="O que já foi pago continua pago. As parcelas que faltam deixam de ser pagas e somem da tela do vendedor."
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
