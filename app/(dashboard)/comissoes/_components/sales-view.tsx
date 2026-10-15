"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, History, Plus, Receipt, Search } from "lucide-react";
import { Badge } from "@/components/badge";
import { Select } from "@/components/select";
import { EmptyState } from "@/components/empty-state";
import { SidePanel } from "@/components/side-panel";
import { LoadingDots } from "@/components/loading-dots";
import { requestJson } from "@/lib/client-request";
import { formatCurrency } from "@/lib/format";
import { brazilDateKey } from "@/lib/timezone";
import type { SaleFilter, SaleListItem } from "@/lib/commissions/queries";
import { SalePanel } from "./sale-panel";
import { LegacyDialog } from "./legacy-dialog";
import { SaleFields, saleFormToBody, type SaleFormOptions, type SaleFormState } from "./sale-form";

const TABS: { value: SaleFilter; label: string }[] = [
  { value: "atencao", label: "Precisam de atenção" },
  { value: "conferir", label: "Vendas antigas a conferir" },
  { value: "todas", label: "Todas as vendas" },
  { value: "canceladas", label: "Canceladas" },
];

/** O que dizer quando a aba está vazia — sempre explicando o porquê, nunca só "nada aqui". */
const EMPTY: Record<SaleFilter, { title: string; description: string }> = {
  atencao: { title: "Tudo em dia", description: "Nenhuma venda está faltando administradora, regra ou valor." },
  conferir: { title: "Nada para conferir", description: "As vendas antigas trazidas para o sistema aparecem aqui até você confirmar." },
  todas: { title: "Nenhuma venda ainda", description: "Toda venda marcada como ganha no CRM aparece aqui com a comissão dela." },
  canceladas: { title: "Nenhuma comissão cancelada", description: "Venda que saiu do ganho, ou que você cancelou, aparece aqui." },
};

function formatDate(iso: string) {
  return brazilDateKey(new Date(iso)).split("-").reverse().join("/");
}

/**
 * Lista de vendas do Financeiro. Abre em "Precisam de atenção" — o que tem
 * trabalho pra fazer — e cada linha já mostra em amarelo o que falta.
 */
export function SalesView({
  filter,
  search,
  sales,
  counts,
  openSale,
  currentMonth,
  options,
  legacy,
}: {
  filter: SaleFilter;
  search: string;
  sales: SaleListItem[];
  counts: { atencao: number; conferir: number };
  openSale: SaleListItem | null;
  currentMonth: string;
  options: SaleFormOptions;
  legacy: { defaultFrom: string; maxDate: string } | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(search);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAdministratorId, setBulkAdministratorId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const selectedReviewCount = sales.filter((x) => selected.has(x.id) && x.status === "REVIEW").length;

  // Modo fila: a venda aberta sabe a posição na lista atual e quem vem
  // depois — "Confirmar e ir para a próxima" sem voltar pra lista.
  const openIndex = openSale ? sales.findIndex((x) => x.id === openSale.id) : -1;
  const queue =
    openIndex >= 0
      ? {
          position: openIndex + 1,
          total: sales.length,
          prevId: sales[openIndex - 1]?.id ?? null,
          nextId: sales[openIndex + 1]?.id ?? null,
        }
      : null;

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 100) next.add(id);
      return next;
    });
  }

  async function runBulk(action: "administrator" | "confirm") {
    setBulkBusy(true);
    const res = await requestJson("/api/commissions/sales/bulk", {
      method: "POST",
      json: { saleIds: Array.from(selected), action, ...(action === "administrator" ? { administratorId: bulkAdministratorId } : {}) },
    });
    setBulkBusy(false);
    if (res.ok) {
      const { updated = 0, skipped = 0 } = (res.data ?? {}) as { updated?: number; skipped?: number };
      setBulkMessage(
        action === "administrator"
          ? `Pronto: ${updated} ${updated === 1 ? "venda atualizada" : "vendas atualizadas"}.`
          : skipped > 0
            ? `${updated} ${updated === 1 ? "venda confirmada" : "vendas confirmadas"}. ${skipped} ${skipped === 1 ? "ficou de fora porque está" : "ficaram de fora porque estão"} sem administradora.`
            : `Pronto: ${updated} ${updated === 1 ? "venda confirmada" : "vendas confirmadas"}. Os vendedores já veem.`,
      );
      setSelected(new Set());
      setBulkAdministratorId("");
      router.refresh();
    }
  }

  function navigate(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value == null || value === "") next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    router.push(qs ? `/comissoes/vendas?${qs}` : "/comissoes/vendas");
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href="/comissoes" className="icon-btn" aria-label="Voltar">
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          </Link>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Vendas e comissões</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {legacy && (
            <button type="button" className="btn-secondary" onClick={() => setLegacyOpen(true)}>
              <History className="h-4 w-4" strokeWidth={2} />
              Trazer vendas antigas
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={() => setManualOpen(true)}>
            <Plus className="h-4 w-4" strokeWidth={2} />
            Lançar venda que não está no CRM
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="scrollbar-thin flex gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const active = tab.value === filter;
            const count = tab.value === "atencao" ? counts.atencao : tab.value === "conferir" ? counts.conferir : null;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => navigate({ f: tab.value, venda: null })}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                {tab.label}
                {count != null && count > 0 && (
                  <span className={`rounded-full px-2 text-sm ${active ? "bg-white/20" : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200"}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigate({ q: query.trim() || null, venda: null });
          }}
          className="relative w-full sm:w-64"
        >
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-neutral-400" strokeWidth={2} />
          <input
            className="field-input pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Procurar cliente, vendedor ou cota"
            aria-label="Procurar venda"
          />
        </form>
      </div>

      {bulkMessage && selected.size === 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-100">
          <span>{bulkMessage}</span>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setBulkMessage(null)}>
            Fechar
          </button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="card sticky top-2 z-10 flex flex-wrap items-center gap-3 p-3 ring-1 ring-brand/30">
          <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {selected.size} {selected.size === 1 ? "venda selecionada" : "vendas selecionadas"}
          </span>
          <div className="w-full sm:w-56">
            <Select
              value={bulkAdministratorId}
              onChange={setBulkAdministratorId}
              options={options.administrators.map((a) => ({ value: a.id, label: a.name }))}
              placeholder="Escolher a administradora"
              ariaLabel="Administradora para as selecionadas"
            />
          </div>
          <button type="button" className="btn-primary btn-sm" disabled={!bulkAdministratorId || bulkBusy} onClick={() => runBulk("administrator")}>
            {bulkBusy ? <LoadingDots /> : "Aplicar a todas"}
          </button>
          {selectedReviewCount > 0 && (
            <button type="button" className="btn-secondary btn-sm" disabled={bulkBusy} onClick={() => runBulk("confirm")}>
              Confirmar {selectedReviewCount === 1 ? "1 conferida" : `${selectedReviewCount} conferidas`}
            </button>
          )}
          <button type="button" className="btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
            Limpar seleção
          </button>
        </div>
      )}

      {sales.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Receipt}
            title={search ? "Nada encontrado" : EMPTY[filter].title}
            description={search ? `Nenhuma venda com "${search}" nesta aba.` : EMPTY[filter].description}
          />
        </div>
      ) : (
        <div className="card p-0">
          <label className="flex items-center gap-3 border-b border-neutral-100 px-4 py-2.5 text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand"
              checked={selected.size > 0 && selected.size === Math.min(sales.length, 100)}
              onChange={(e) => setSelected(e.target.checked ? new Set(sales.slice(0, 100).map((x) => x.id)) : new Set())}
            />
            {sales.length > 100 ? "Selecionar as 100 primeiras" : "Selecionar todas"}
          </label>
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {sales.map((sale) => (
              <li key={sale.id} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 accent-brand"
                  checked={selected.has(sale.id)}
                  onChange={() => toggleSelected(sale.id)}
                  aria-label={`Selecionar ${sale.clientName}`}
                />
                <button type="button" onClick={() => navigate({ venda: sale.id })} className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{sale.clientName}</span>
                      {sale.status === "REVIEW" && <Badge tone="warning">A conferir</Badge>}
                      {sale.status === "CANCELLED" && <Badge tone="neutral">Comissão cancelada</Badge>}
                    </p>
                    <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
                      Vendida por {sale.sellerName} em {formatDate(sale.saleDate)}
                      {sale.administratorName ? `, ${sale.administratorName}` : ""}
                      {sale.netValue != null ? `, ${formatCurrency(sale.netValue)} líquido` : ""}.
                    </p>
                    {sale.problems.length > 0 && (
                      <p className="mt-1 flex items-start gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
                        {sale.problems.join(". ")}.
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-neutral-900 tabular-nums dark:text-neutral-100">{formatCurrency(sale.commissionTotal)}</p>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">
                      {sale.paidCount > 0 ? `${sale.paidCount} ${sale.paidCount === 1 ? "parcela paga" : "parcelas pagas"}` : "de comissão"}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {openSale && (
        <SalePanel
          key={openSale.id}
          sale={openSale}
          currentMonth={currentMonth}
          options={options}
          onClose={() => navigate({ venda: null })}
          queue={queue}
          onNavigate={(id) => navigate({ venda: id })}
        />
      )}
      {legacyOpen && legacy && (
        <LegacyDialog
          defaultFrom={legacy.defaultFrom}
          maxDate={legacy.maxDate}
          onClose={() => setLegacyOpen(false)}
          onDone={() => {
            setLegacyOpen(false);
            navigate({ f: "conferir", venda: null });
          }}
        />
      )}
      {manualOpen && <ManualSalePanel options={options} onClose={() => setManualOpen(false)} onCreated={(id) => { setManualOpen(false); navigate({ f: "todas", venda: id }); }} />}
    </div>
  );
}

function ManualSalePanel({ options, onClose, onCreated }: { options: SaleFormOptions; onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState<SaleFormState>({
    clientName: "",
    sellerId: "",
    saleDate: brazilDateKey(),
    administratorId: "",
    modality: "FULL",
    netValue: "",
    grossValue: "",
    clientInstallment: "",
    creditType: "",
    quotaNumber: "",
    groupNumber: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSave = !!form.clientName.trim() && !!form.sellerId && !!form.saleDate;

  async function save() {
    setSaving(true);
    setError(null);
    const res = await requestJson<{ id: string }>("/api/commissions/sales", { method: "POST", json: saleFormToBody(form) }, { silent: true });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onCreated(res.data.id);
  }

  return (
    <SidePanel title="Lançar venda que não está no CRM" onClose={onClose} maxWidth="max-w-xl">
      <div className="space-y-4">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Para uma venda que não passou pelo CRM, mas tem comissão a pagar. Ela segue as mesmas regras de qualquer venda.
        </p>
        <SaleFields value={form} onChange={setForm} options={options} showClient />
        {error && <p className="field-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="button" className="btn-primary" onClick={save} disabled={saving || !canSave}>
            {saving ? <LoadingDots /> : "Lançar venda e calcular comissão"}
          </button>
        </div>
      </div>
    </SidePanel>
  );
}
