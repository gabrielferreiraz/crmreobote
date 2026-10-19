"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Clock,
  Download,
  Lock,
  Plus,
  Receipt,
  Search,
  Settings2,
  Wallet,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { LoadingDots } from "@/components/loading-dots";
import { useUndoToast } from "@/components/undo-provider";
import { requestJson } from "@/lib/client-request";
import { formatCurrency } from "@/lib/format";
import { addMonths, formatMonthLong } from "@/lib/commissions/engine";
import { clientAllowsPayment } from "@/lib/commissions/client-payment";
import { plainSearchText } from "@/lib/commissions/search-text";
import type { CommissionWeight, EntryView, ManagerAlerts, OpenDispute } from "@/lib/commissions/queries";
import { StatTile } from "./stat-tile";
import { EntryRow } from "./entry-row";
import { AdjustmentDialog } from "./adjustment-dialog";
import { CloseMonthDialog } from "./close-month-dialog";
import { DisputeList } from "./dispute-list";
import { WeightCard } from "./weight-card";

type Setup = { started: boolean; administratorsCount: number; rulesCount: number };

/** O que a EMPRESA paga (fica de fora o que a administradora paga direto pro consultor). */
const companyPays = (e: EntryView) => !e.paidByAdministrator;
/** Pronta pra pagar: a receber, da empresa, e o cliente já pagou a parcela (ou não depende disso). */
const readyToPay = (e: EntryView) => e.status === "SCHEDULED" && companyPays(e) && clientAllowsPayment(e.clientPayment);
/** Esperando o Financeiro conferir se o cliente pagou a parcela do mês. */
const waitingClient = (e: EntryView) => e.status === "SCHEDULED" && e.clientPayment === "PENDING";
const sum = (list: EntryView[]) => list.reduce((acc, e) => acc + e.amount, 0);
/** Perdida porque o cliente não pagou — aparece (com o motivo), mas não entra em total nenhum. */
const isLost = (e: EntryView) => e.status === "CANCELLED";

/**
 * Mesa do Financeiro, um mês por vez. De cima pra baixo, na ordem do
 * trabalho: quem está esperando resposta (contestações), o que precisa de
 * ação (avisos), os números do mês com "Fechar o mês", e uma linha por
 * pessoa com "Pagar" — que paga NA HORA e oferece Desfazer, sem "Tem
 * certeza?". Abrir a pessoa mostra de onde vem cada valor.
 */
export function ManagerMonth({
  month,
  currentMonth,
  firstMonth,
  lastMonth,
  entries: serverEntries,
  alerts,
  payDay,
  setup,
  members,
  disputes,
  weight,
  expectedRevenue,
}: {
  month: string;
  currentMonth: string;
  firstMonth: string;
  lastMonth: string;
  entries: EntryView[];
  alerts: ManagerAlerts;
  payDay: number;
  setup: Setup;
  members: { id: string; name: string }[];
  disputes: OpenDispute[];
  weight: CommissionWeight;
  /** O que as administradoras devem pagar pra corretora neste mês (0 = nada cadastrado). */
  expectedRevenue: number;
}) {
  const router = useRouter();
  const pushUndoToast = useUndoToast();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [paying, setPaying] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  // Otimista: "Pagar" e "Todos pagaram" mudam a tela no clique; quando o
  // servidor manda os dados novos, o ajuste local some sozinho (vale só pra
  // aquela versão da lista). Se der erro, volta.
  const [overrides, setOverrides] = useState<{ base: EntryView[]; patch: Map<string, Partial<EntryView>> } | null>(null);
  const entries = useMemo(
    () =>
      overrides && overrides.base === serverEntries
        ? serverEntries.map((e) => (overrides.patch.has(e.id) ? { ...e, ...overrides.patch.get(e.id) } : e))
        : serverEntries,
    [overrides, serverEntries],
  );
  function applyLocally(ids: string[], changes: Partial<EntryView>) {
    setOverrides((prev) => {
      const patch = new Map(prev && prev.base === serverEntries ? prev.patch : []);
      for (const id of ids) patch.set(id, { ...patch.get(id), ...changes });
      return { base: serverEntries, patch };
    });
  }
  // Trocar de mês: a tela atual esmaece enquanto o próximo carrega (em vez de parecer travada).
  const [navigating, startNavigation] = useTransition();
  const monthName = formatMonthLong(month, { withYear: false }).toLowerCase();
  const hasWeightData = weight.some((item) => item.sold > 0);

  const totals = useMemo(() => {
    const toPay = entries.filter(readyToPay);
    const held = entries.filter((e) => e.status === "ON_HOLD");
    const waiting = entries.filter(waitingClient);
    return {
      waitingCount: waiting.length,
      waitingSales: new Set(waiting.map((e) => e.saleId)).size,
      waiting: sum(waiting.filter(companyPays)),
      toPay: sum(toPay),
      toPayCount: toPay.length,
      held: sum(held),
      heldCount: held.length,
      paid: sum(entries.filter((e) => e.status === "PAID" && companyPays(e))),
      direct: sum(entries.filter((e) => e.paidByAdministrator)),
      // Tudo que sai do caixa da empresa no mês (a pagar + travado + pago).
      companyAll: sum(entries.filter((e) => companyPays(e) && e.status !== "CANCELLED")),
    };
  }, [entries]);

  const people = useMemo(() => {
    const byPerson = new Map<string, { id: string; name: string; entries: EntryView[] }>();
    for (const e of entries) {
      const person = byPerson.get(e.beneficiaryId) ?? { id: e.beneficiaryId, name: e.beneficiaryName, entries: [] };
      person.entries.push(e);
      byPerson.set(e.beneficiaryId, person);
    }
    return Array.from(byPerson.values())
      .map((p) => {
        const toPay = p.entries.filter(readyToPay);
        const counted = p.entries.filter((e) => !isLost(e));
        return {
          waiting: p.entries.filter(waitingClient).length,
          ...p,
          toPay: sum(toPay),
          toPayCount: toPay.length,
          held: p.entries.filter((e) => e.status === "ON_HOLD").length,
          lost: p.entries.length - counted.length,
          disputed: p.entries.filter((e) => e.dispute?.status === "OPEN").length,
          total: sum(counted),
          // "Tudo pago" só de verdade: pago pela empresa, ou pago direto pela
          // administradora SEM estar esperando o cliente (antes aparecia ✓ verde
          // em quem ainda dependia do cliente pagar a parcela).
          allPaid: counted.length > 0 && counted.every((e) => e.status === "PAID" || (e.paidByAdministrator && e.status === "SCHEDULED" && !waitingClient(e))),
          allDirect: counted.length > 0 && counted.every((e) => e.paidByAdministrator),
          waitingSaleIds: Array.from(new Set(p.entries.filter(waitingClient).flatMap((e) => (e.saleId ? [e.saleId] : [])))),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [entries]);

  const query = plainSearchText(search);
  const visiblePeople = query ? people.filter((p) => plainSearchText(p.name).includes(query)) : people;

  function goTo(target: string) {
    startNavigation(() => router.push(target === currentMonth ? "/comissoes" : `/comissoes?mes=${target}`));
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmClients(personId: string, saleIds: string[]) {
    setConfirming(personId);
    const sales = new Set(saleIds);
    const ids = entries.filter((e) => e.beneficiaryId === personId && waitingClient(e) && e.saleId && sales.has(e.saleId)).map((e) => e.id);
    applyLocally(ids, { clientPayment: "PAID" });
    const res = await requestJson("/api/commissions/client-payments", { method: "POST", json: { month, saleIds, state: "PAID" } });
    setConfirming(null);
    if (res.ok) router.refresh();
    else setOverrides(null);
  }

  async function payPerson(beneficiaryId: string) {
    setPaying(beneficiaryId);
    applyLocally(
      entries.filter((e) => e.beneficiaryId === beneficiaryId && readyToPay(e)).map((e) => e.id),
      { status: "PAID" },
    );
    const res = await requestJson("/api/commissions/entries/pay-month", { method: "POST", json: { month, beneficiaryId } });
    setPaying(null);
    if (res.ok) {
      pushUndoToast(res.data?.undo);
      router.refresh();
    } else {
      setOverrides(null);
    }
  }

  return (
    <div className={`w-full space-y-4 transition-opacity lg:space-y-5 ${navigating ? "pointer-events-none opacity-60" : ""}`} aria-busy={navigating}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Comissões</h1>
        <div className="scrollbar-thin flex w-full items-center gap-2 overflow-x-auto pb-1 sm:w-auto sm:pb-0">
          <Link href={`/comissoes/clientes?mes=${month}`} className="btn-secondary shrink-0" title="Conferir quem pagou a parcela">
            <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
            Pagamentos
          </Link>
          <Link href="/comissoes/vendas" className="btn-secondary shrink-0">
            <Receipt className="h-4 w-4" strokeWidth={2} />
            Vendas
          </Link>
          <Link href="/comissoes/configuracoes" className="btn-secondary shrink-0">
            <Settings2 className="h-4 w-4" strokeWidth={2} />
            Configurar
          </Link>
        </div>
      </div>

      {!setup.started ? (
        <SetupSteps setup={setup} />
      ) : (
        <>
          <DisputeList disputes={disputes} />

          {(alerts.reviewCount > 0 || alerts.noAdministratorCount > 0 || alerts.overdue || totals.waitingCount > 0) && (
            <div className="space-y-2">
              {totals.waitingCount > 0 && (
                <AlertLine
                  href={`/comissoes/clientes?mes=${month}`}
                  icon={CheckCircle2}
                  action="Conferir"
                  title={totals.waitingSales === 1 ? "1 pagamento para conferir" : `${totals.waitingSales} pagamentos para conferir`}
                  description={totals.waiting > 0 ? `${formatCurrency(totals.waiting)} aguardando liberação` : undefined}
                />
              )}
              {alerts.noAdministratorCount > 0 && (
                <AlertLine
                  href="/comissoes/vendas?f=atencao&p=adm"
                  icon={Building2}
                  action="Corrigir"
                  title={alerts.noAdministratorCount === 1 ? "1 venda sem administradora" : `${alerts.noAdministratorCount} vendas sem administradora`}
                  description="Comissões ainda não calculadas"
                />
              )}
              {alerts.reviewCount > 0 && (
                <AlertLine
                  href="/comissoes/vendas?f=conferir"
                  icon={ClipboardCheck}
                  action="Revisar"
                  title={alerts.reviewCount === 1 ? "1 venda para revisar" : `${alerts.reviewCount} vendas para revisar`}
                />
              )}
              {alerts.overdue && alerts.overdue.month !== month && (
                <AlertLine
                  href={`/comissoes?mes=${alerts.overdue.month}`}
                  icon={Clock}
                  action="Ver"
                  tone="danger"
                  title={alerts.overdue.count === 1 ? "1 parcela atrasada" : `${alerts.overdue.count} parcelas atrasadas`}
                  description={`Desde ${formatMonthLong(alerts.overdue.month).toLowerCase()}`}
                />
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <button type="button" className="icon-btn" aria-label="Mês anterior" disabled={month <= firstMonth} onClick={() => goTo(addMonths(month, -1))}>
                <ChevronLeft className="h-4 w-4" strokeWidth={2} />
              </button>
              <h2 className="min-w-[11rem] text-center text-lg font-semibold text-neutral-900 dark:text-neutral-100">{formatMonthLong(month)}</h2>
              <button type="button" className="icon-btn" aria-label="Próximo mês" disabled={month >= lastMonth} onClick={() => goTo(addMonths(month, 1))}>
                <ChevronRight className="h-4 w-4" strokeWidth={2} />
              </button>
              {month !== currentMonth && (
                <button type="button" className="btn-ghost btn-sm" onClick={() => goTo(currentMonth)}>
                  Mês atual
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-secondary" onClick={() => setAdjustmentOpen(true)}>
                <Plus className="h-4 w-4" strokeWidth={2} />
                Lançar ajuste
              </button>
              {totals.toPayCount > 0 && (
                <a href={`/api/commissions/export?month=${month}`} className="btn-secondary">
                  <Download className="h-4 w-4" strokeWidth={2} />
                  Baixar planilha
                </a>
              )}
              {(totals.toPayCount > 0 || totals.heldCount > 0) && (
                <button type="button" className="btn-primary" onClick={() => setCloseOpen(true)}>
                  <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                  Fechar o mês
                </button>
              )}
            </div>
          </div>

          <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${expectedRevenue > 0 ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
            <StatTile
              icon={Wallet}
              tone="brand"
              label="Falta pagar"
              value={formatCurrency(totals.toPay)}
              hint={
                totals.toPayCount === 0
                  ? "Em dia"
                  : `${totals.toPayCount} ${totals.toPayCount === 1 ? "parcela" : "parcelas"} · dia ${payDay}`
              }
            />
            <StatTile
              icon={Lock}
              tone={totals.heldCount > 0 ? "warning" : "neutral"}
              label="Travado"
              value={formatCurrency(totals.held)}
              hint={totals.heldCount === 0 ? "Sem bloqueios" : `${totals.heldCount} ${totals.heldCount === 1 ? "parcela" : "parcelas"}`}
            />
            <StatTile
              icon={CalendarCheck}
              tone="success"
              label="Já pago"
              value={formatCurrency(totals.paid)}
              hint={totals.direct > 0 ? `+ ${formatCurrency(totals.direct)} direto` : "No mês"}
            />
            {expectedRevenue > 0 && (
              <StatTile
                icon={Building2}
                tone="neutral"
                label="Saldo da corretora"
                value={formatCurrency(expectedRevenue - totals.companyAll)}
                hint={`Receita ${formatCurrency(expectedRevenue)}`}
              />
            )}
          </div>

          <div className={`grid min-h-80 items-stretch gap-4 xl:min-h-[calc(100dvh-22rem)] ${hasWeightData ? "xl:grid-cols-[minmax(0,1.7fr)_minmax(20rem,0.8fr)]" : ""}`}>
            {people.length === 0 ? (
              <div className="card flex min-h-80 items-center justify-center rounded-lg">
                <EmptyState
                  icon={Wallet}
                  title={`Sem comissões em ${monthName}`}
                  description={month < currentMonth ? "Nenhuma parcela neste mês." : "As próximas parcelas aparecerão aqui."}
                />
              </div>
            ) : (
              <section className="card h-full min-h-80 overflow-hidden rounded-lg p-0">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3.5 dark:border-neutral-800">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Quem recebe em {monthName}</h3>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">{people.length} {people.length === 1 ? "pessoa" : "pessoas"}</span>
                  </div>
                  {people.length > 6 && (
                    <div className="relative w-full sm:w-64">
                      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-neutral-400" strokeWidth={2} />
                      <input className="field-input pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Procurar pessoa" aria-label="Procurar pessoa" />
                    </div>
                  )}
                </div>
              {visiblePeople.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-neutral-500">Ninguém com esse nome neste mês.</p>
              ) : (
                <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {visiblePeople.map((person) => {
                    const open = expanded.has(person.id);
                    return (
                      <div key={person.id} className={open ? "bg-neutral-50/70 dark:bg-white/[0.015]" : ""}>
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)_4.75rem]">
                          <button type="button" onClick={() => toggle(person.id)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                            <ChevronDown className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${open ? "" : "-rotate-90"}`} strokeWidth={2} />
                            <Avatar name={person.name} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{person.name}</p>
                              <div className="flex flex-wrap gap-x-3 text-xs text-neutral-500 dark:text-neutral-400">
                                <span>{person.entries.length - person.lost} {person.entries.length - person.lost === 1 ? "parcela" : "parcelas"}</span>
                                {person.held > 0 && <span className="text-amber-700 dark:text-amber-300">{person.held} travada{person.held === 1 ? "" : "s"}</span>}
                                {person.lost > 0 && <span className="text-red-700 dark:text-red-300">{person.lost} perdida{person.lost === 1 ? "" : "s"}</span>}
                                {person.disputed > 0 && <span className="text-red-700 dark:text-red-300">{person.disputed} contestada{person.disputed === 1 ? "" : "s"}</span>}
                                {person.waiting > 0 && <span className="text-amber-700 dark:text-amber-300">{person.waiting} aguardando</span>}
                              </div>
                            </div>
                          </button>
                          <div className="text-right">
                              <p className="text-sm font-semibold text-neutral-900 tabular-nums dark:text-neutral-100">
                                {formatCurrency(person.toPayCount > 0 ? person.toPay : person.total)}
                              </p>
                              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                {person.toPayCount > 0
                                  ? "falta pagar"
                                  : person.waiting > 0
                                    ? "aguardando o cliente"
                                    : person.allPaid
                                      ? person.allDirect
                                        ? "pago pela administradora"
                                        : "tudo pago"
                                      : "no mês"}
                              </p>
                          </div>
                          <div className="col-span-2 flex min-h-8 items-center justify-end sm:col-span-1">
                            {person.toPayCount > 0 ? (
                              <button type="button" className="btn-secondary btn-sm w-full sm:w-auto" disabled={paying === person.id} onClick={() => payPerson(person.id)}>
                                {paying === person.id ? <LoadingDots /> : "Pagar"}
                              </button>
                            ) : person.waiting > 0 ? (
                              <Clock className="h-5 w-5 text-amber-500" strokeWidth={2} aria-label="Aguardando o cliente" />
                            ) : person.allPaid ? (
                              <CheckCircle2 className="h-5 w-5 text-emerald-500" strokeWidth={2} aria-label="Tudo pago" />
                            ) : (
                              <span className="w-5" />
                            )}
                          </div>
                        </div>
                        {open && (
                          <ul className="divide-y divide-neutral-200 border-t border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-950/40">
                            {person.waitingSaleIds.length > 1 && (
                              <li className="flex flex-wrap items-center justify-between gap-2 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
                                <span>
                                  {person.waitingSaleIds.length} clientes aguardando confirmação
                                </span>
                                <button
                                  type="button"
                                  className="btn-secondary btn-sm"
                                  disabled={confirming === person.id}
                                  onClick={() => confirmClients(person.id, person.waitingSaleIds)}
                                >
                                  {confirming === person.id ? <LoadingDots /> : "Todos pagaram"}
                                </button>
                              </li>
                            )}
                            {person.entries.map((entry) => (
                              <EntryRow key={entry.id} entry={entry} currentMonth={currentMonth} show="client" onChanged={() => router.refresh()} />
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              </section>
            )}

            {hasWeightData && <WeightCard weight={weight} />}
          </div>
        </>
      )}

      {closeOpen && <CloseMonthDialog month={month} entries={entries} onClose={() => setCloseOpen(false)} />}
      {adjustmentOpen && (
        <AdjustmentDialog
          members={members}
          currentMonth={currentMonth}
          defaultMonth={month}
          onClose={() => setAdjustmentOpen(false)}
          onSaved={() => {
            setAdjustmentOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/** Pendência curta + ação direta. */
function AlertLine({
  href,
  icon: Icon,
  action,
  title,
  description,
  tone = "warning",
}: {
  href: string;
  icon: typeof AlertTriangle;
  action: string;
  title: string;
  description?: string;
  tone?: "warning" | "danger";
}) {
  const colors =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-500/10 dark:text-red-100"
      : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-100";
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${colors}`}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-black/5 dark:bg-white/10">
        <Icon className="h-4 w-4" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{title}</p>
        {description && <p className="truncate text-xs opacity-75">{description}</p>}
      </div>
      <Link href={href} className="btn-secondary btn-sm">
        {action}
        <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
      </Link>
    </div>
  );
}

/** Antes de ligar: os 3 passos, cada um marcando sozinho quando estiver feito. */
function SetupSteps({ setup }: { setup: Setup }) {
  const steps = [
    { done: setup.administratorsCount > 0, label: "Cadastrar administradoras" },
    { done: setup.rulesCount > 0, label: "Definir valores" },
    { done: setup.started, label: "Escolher mês inicial" },
  ];
  return (
    <div className="card space-y-5 rounded-lg p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Configure as comissões</h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">Complete os 3 passos para liberar o módulo.</p>
        </div>
        <Link href="/comissoes/configuracoes" className="btn-primary shrink-0 self-start sm:self-auto">
          <Settings2 className="h-4 w-4" strokeWidth={2} />
          Configurar
        </Link>
      </div>
      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.label} className="flex items-center gap-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
            {step.done ? (
              <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-500" strokeWidth={2} />
            ) : (
              <Circle className="h-6 w-6 shrink-0 text-neutral-300 dark:text-neutral-600" strokeWidth={2} />
            )}
            <span className={`text-sm ${step.done ? "text-neutral-500 line-through" : "font-medium text-neutral-900 dark:text-neutral-100"}`}>
              {i + 1}. {step.label}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
