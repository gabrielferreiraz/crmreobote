"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
import { problemLabel } from "@/lib/commissions/engine";
import { plainSearchText } from "@/lib/commissions/search-text";
import { fetchSaleEntries, SalePanel } from "./sale-panel";
import { LegacyDialog } from "./legacy-dialog";
import { SaleFields, saleFormToBody, type SaleFormOptions, type SaleFormState } from "./sale-form";

const TABS: { value: SaleFilter; label: string }[] = [
  { value: "atencao", label: "Pendentes" },
  { value: "conferir", label: "A conferir" },
  { value: "todas", label: "Todas" },
  { value: "canceladas", label: "Canceladas" },
];

/** O que dizer quando a aba está vazia — sempre explicando o porquê, nunca só "nada aqui". */
const EMPTY: Record<SaleFilter, { title: string; description: string }> = {
  atencao: { title: "Tudo em dia", description: "Nenhuma pendência." },
  conferir: { title: "Nada para conferir", description: "Vendas antigas aparecem aqui." },
  todas: { title: "Nenhuma venda", description: "Vendas ganhas aparecem aqui." },
  canceladas: { title: "Nenhuma cancelada", description: "" },
};

type BulkAction = "administrator" | "creditType" | "confirm";

/** Quantas vendas por chamada no "aplicar a todas" (o limite da rota). */
const BULK_BATCH = 100;

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
  sellerId,
  sellers,
  sales,
  total,
  counts,
  openSale,
  currentMonth,
  options,
  legacy,
}: {
  filter: SaleFilter;
  search: string;
  /** "" = todos os vendedores. */
  sellerId: string;
  sellers: { id: string; name: string }[];
  sales: SaleListItem[];
  /** Quantas vendas batem com o filtro (a lista mostra no máximo as 300 mais recentes). */
  total: number;
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
  const [bulkCreditType, setBulkCreditType] = useState("");
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);
  // Trocar de aba/filtro/busca refaz a lista no servidor — a lista esmaece
  // enquanto isso, pra ninguém achar que o clique não pegou.
  const [loading, startLoading] = useTransition();
  const sellerName = sellerId ? (sellers.find((x) => x.id === sellerId)?.name ?? "este vendedor") : null;

  // Filtro rápido por tipo de pendência ("Falta administradora"…)
  // — filtrar, selecionar todas e resolver de uma vez. Na própria tela, sobre
  // as vendas carregadas.
  const problemCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const sale of sales) for (const p of sale.problems) map.set(p, (map.get(p) ?? 0) + 1);
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [sales]);
  // `?p=adm` (vindo do aviso da mesa do mês) já abre filtrado em "sem administradora".
  const [problemFilter, setProblemFilter] = useState<string | null>(params.get("p") === "adm" ? problemLabel({ code: "NO_ADMINISTRATOR" }) : null);
  const activeProblem = problemFilter && problemCounts.some(([p]) => p === problemFilter) ? problemFilter : null;
  // Enquanto a busca do servidor não volta, já filtra o que está na tela
  // (sem acento) — a lista reage na hora em vez de esperar a ida ao banco.
  const typed = plainSearchText(query);
  const searching = typed !== plainSearchText(search) && typed.length > 0;
  const shown = sales.filter(
    (x) =>
      (!activeProblem || x.problems.includes(activeProblem)) &&
      (!searching ||
        plainSearchText(x.clientName).includes(typed) ||
        plainSearchText(x.sellerName).includes(typed) ||
        (x.quotaNumber ?? "").toLowerCase().includes(typed) ||
        (x.groupNumber ?? "").toLowerCase().includes(typed)),
  );

  // Venda aberta: vem da URL (?venda=), mas abrir/fechar/ir pra próxima NÃO
  // passa pelo servidor — a venda já está na lista; só a URL muda (pushState,
  // que o Next sincroniza com useSearchParams). Link direto pra uma venda fora
  // da lista continua funcionando pelo `openSale` que o servidor manda.
  const openId = params.get("venda");
  const currentSale = openId ? (sales.find((x) => x.id === openId) ?? (openSale?.id === openId ? openSale : null)) : null;
  function showSale(id: string | null) {
    const next = new URLSearchParams(window.location.search);
    if (id) next.set("venda", id);
    else next.delete("venda");
    const qs = next.toString();
    window.history.pushState(null, "", qs ? `?${qs}` : window.location.pathname);
  }
  const selectedReviewCount = shown.filter((x) => selected.has(x.id) && x.status === "REVIEW").length;

  // Modo fila: a venda aberta sabe a posição na lista atual e quem vem
  // depois — "Confirmar e ir para a próxima" sem voltar pra lista.
  const openIndex = currentSale ? shown.findIndex((x) => x.id === currentSale.id) : -1;
  const queue =
    openIndex >= 0
      ? {
        position: openIndex + 1,
        total: shown.length,
        prevId: shown[openIndex - 1]?.id ?? null,
        nextId: shown[openIndex + 1]?.id ?? null,
      }
      : null;

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runBulk(action: BulkAction) {
    setBulkBusy(true);
    setBulkAction(action);
    // O servidor recalcula no máximo 100 por vez (uma transação cada) — em
    // lotes, um depois do outro; se um falhar, para e diz quantas já foram.
    const ids = Array.from(selected);
    let updated = 0;
    let skipped = 0;
    let failed = false;
    for (let i = 0; i < ids.length; i += BULK_BATCH) {
      if (ids.length > BULK_BATCH) setBulkProgress(`${Math.min(i + BULK_BATCH, ids.length)} de ${ids.length}`);
      const res = await requestJson("/api/commissions/sales/bulk", {
        method: "POST",
        json: {
          saleIds: ids.slice(i, i + BULK_BATCH),
          action,
          ...(action === "administrator" ? { administratorId: bulkAdministratorId } : {}),
          ...(action === "creditType" ? { creditType: bulkCreditType } : {}),
        },
      });
      if (!res.ok) {
        failed = true;
        break;
      }
      const data = (res.data ?? {}) as { updated?: number; skipped?: number };
      updated += data.updated ?? 0;
      skipped += data.skipped ?? 0;
    }
    setBulkBusy(false);
    setBulkAction(null);
    setBulkProgress(null);
    if (failed && updated === 0) return;
    const doneText =
      action !== "confirm"
        ? `${updated} ${updated === 1 ? "venda atualizada" : "vendas atualizadas"}.`
        : skipped > 0
          ? `${updated} confirmadas · ${skipped} sem administradora ficaram de fora.`
          : `${updated} ${updated === 1 ? "venda confirmada" : "vendas confirmadas"}.`;
    setBulkMessage(
      failed
        ? `${updated} atualizadas antes do erro. Tente de novo.`
        : doneText,
    );
    setSelected(new Set());
    setBulkAdministratorId("");
    setBulkCreditType("");
    router.refresh();
  }

  // Procura enquanto digita (sem precisar apertar Enter).
  useEffect(() => {
    const text = query.trim();
    if (text === search.trim()) return;
    // replace: cada letra não vira uma página no "voltar" do navegador.
    const timer = setTimeout(() => navigate({ q: text || null, venda: null }, { replace: true }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navigate lê os params atuais; rodar só quando o texto muda
  }, [query]);

  function navigate(changes: Record<string, string | null>, opts?: { replace?: boolean }) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value == null || value === "") next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    const href = qs ? `/comissoes/vendas?${qs}` : "/comissoes/vendas";
    startLoading(() => {
      if (opts?.replace) router.replace(href, { scroll: false });
      else router.push(href);
    });
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
            Venda fora do CRM
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
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${active
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
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          {sellers.length > 1 && (
            <div className="w-full sm:w-56">
              <Select
                value={sellerId}
                onChange={(v) => {
                  setSelected(new Set());
                  navigate({ v: v || null, venda: null });
                }}
                options={[{ value: "", label: "Todos os vendedores" }, ...sellers.map((x) => ({ value: x.id, label: x.name }))]}
                ariaLabel="Vendedor"
              />
            </div>
          )}
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
              placeholder="Buscar cliente ou cota"
              aria-label="Procurar venda"
            />
          </form>
        </div>
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
        <div className="card sticky top-2 z-10 space-y-3 p-4 ring-1 ring-brand/30">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {selected.size} {selected.size === 1 ? "venda selecionada" : "vendas selecionadas"}
              {bulkProgress && <span className="ml-2 font-normal text-neutral-500">— salvando {bulkProgress}…</span>}
            </span>
            <button type="button" className="btn-ghost btn-sm" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
              Limpar seleção
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-full text-sm text-neutral-700 sm:w-28 dark:text-neutral-300">Administradora</span>
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
              {bulkBusy && bulkAction === "administrator" ? <LoadingDots /> : "Aplicar"}
            </button>
          </div>
          {options.creditTypes.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-full text-sm text-neutral-700 sm:w-28 dark:text-neutral-300">Categoria</span>
              <div className="w-full sm:w-56">
                <Select
                  value={bulkCreditType}
                  onChange={setBulkCreditType}
                  options={options.creditTypes.map((c) => ({ value: c, label: c }))}
                  placeholder="Escolher a categoria"
                  ariaLabel="Categoria para as selecionadas"
                />
              </div>
              <button type="button" className="btn-primary btn-sm" disabled={!bulkCreditType || bulkBusy} onClick={() => runBulk("creditType")}>
                {bulkBusy && bulkAction === "creditType" ? <LoadingDots /> : "Aplicar"}
              </button>
            </div>
          )}
          {selectedReviewCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
              <span className="text-sm text-neutral-700 dark:text-neutral-300">
                {selectedReviewCount} a conferir
              </span>
              <button type="button" className="btn-secondary btn-sm" disabled={bulkBusy} onClick={() => runBulk("confirm")}>
                {bulkBusy && bulkAction === "confirm" ? <LoadingDots /> : selectedReviewCount === 1 ? "Confirmar" : `Confirmar as ${selectedReviewCount}`}
              </button>
            </div>
          )}
        </div>
      )}

      {filter === "atencao" && problemCounts.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-neutral-600 dark:text-neutral-400">Mostrar:</span>
          {[[null, `Todas (${sales.length})`] as const, ...problemCounts.map(([p, n]) => [p, `${p} (${n})`] as const)].map(([value, label]) => (
            <button
              key={value ?? "all"}
              type="button"
              onClick={() => {
                setProblemFilter(value);
                setSelected(new Set());
              }}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${activeProblem === value
                  ? "border-brand bg-brand-light text-brand"
                  : "border-neutral-200 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {sales.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Receipt}
            title={search || sellerId ? "Nada encontrado" : EMPTY[filter].title}
            description={
              search || sellerId
                ? `${sellerName ?? ""}${sellerName && search ? " · " : ""}${search ? `"${search}"` : ""}`
                : EMPTY[filter].description
            }
          />
        </div>
      ) : (
        <div className={`card p-0 transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`} aria-busy={loading}>
          {total > sales.length && (
            <p className="border-b border-neutral-100 bg-neutral-50 px-4 py-2.5 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400">
              Mostrando {sales.length} de {total.toLocaleString("pt-BR")} — use a busca para as demais.
            </p>
          )}
          <label className="flex items-center gap-3 border-b border-neutral-100 px-4 py-2.5 text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand"
              checked={selected.size > 0 && selected.size === shown.length}
              onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((x) => x.id)) : new Set())}
            />
            {shown.length === 1 ? "Selecionar" : `Selecionar as ${shown.length}`}
          </label>
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {shown.map((sale) => (
              <li key={sale.id} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 accent-brand"
                  checked={selected.has(sale.id)}
                  onChange={() => toggleSelected(sale.id)}
                  aria-label={`Selecionar ${sale.clientName}`}
                />
                <button
                  type="button"
                  onClick={() => showSale(sale.id)}
                  // Busca as parcelas ao passar o mouse/encostar — o painel abre já preenchido.
                  onMouseEnter={() => void fetchSaleEntries(sale.id)}
                  onFocus={() => void fetchSaleEntries(sale.id)}
                  className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{sale.clientName}</span>
                      {sale.status === "REVIEW" && <Badge tone="warning">A conferir</Badge>}
                      {sale.status === "CANCELLED" && <Badge tone="neutral">Comissão cancelada</Badge>}
                    </p>
                    <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
                      {sale.sellerName} · {formatDate(sale.saleDate)}
                      {sale.administratorName ? ` · ${sale.administratorName}` : ""}
                      {sale.creditType ? ` · ${sale.creditType}` : ""}
                      {sale.netValue != null ? ` · ${formatCurrency(sale.netValue)}` : ""}
                    </p>
                    {sale.problems.length > 0 && (
                      <p className="mt-1 flex items-start gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
                        {sale.problems.join(" · ")}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    {sale.commissionTotal !== 0 || sale.paidCount > 0 ? (
                      <>
                        <p className="text-sm font-semibold text-neutral-900 tabular-nums dark:text-neutral-100">{formatCurrency(sale.commissionTotal)}</p>
                        <p className="text-sm text-neutral-500 dark:text-neutral-400">
                          {sale.paidCount > 0 ? `${sale.paidCount} ${sale.paidCount === 1 ? "parcela paga" : "parcelas pagas"}` : "de comissão"}
                        </p>
                      </>
                    ) : (
                      // Sem comissão calculada ainda (falta algo, em amarelo ao lado) — "R$ 0,00" parecia "não ganha nada".
                      <p className="text-sm text-neutral-500 dark:text-neutral-400">Sem comissão</p>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {currentSale && (
        <SalePanel
          key={currentSale.id}
          sale={currentSale}
          currentMonth={currentMonth}
          options={options}
          onClose={() => showSale(null)}
          queue={queue}
          onNavigate={(id) => showSale(id)}
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
    autoDebit: false,
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
    <SidePanel title="Venda fora do CRM" onClose={onClose} maxWidth="max-w-xl">
      <div className="space-y-4">
        <SaleFields value={form} onChange={setForm} options={options} showClient />
        {error && <p className="field-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="button" className="btn-primary" onClick={save} disabled={saving || !canSave}>
            {saving ? <LoadingDots /> : "Lançar venda"}
          </button>
        </div>
      </div>
    </SidePanel>
  );
}
