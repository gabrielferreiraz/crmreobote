"use client";

import { useMemo, useState } from "react";
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
const sum = (list: EntryView[]) => list.reduce((acc, e) => acc + e.amount, 0);

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
  entries,
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
  const monthName = formatMonthLong(month, { withYear: false }).toLowerCase();

  const totals = useMemo(() => {
    const toPay = entries.filter((e) => e.status === "SCHEDULED" && companyPays(e));
    const held = entries.filter((e) => e.status === "ON_HOLD");
    return {
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
        const toPay = p.entries.filter((e) => e.status === "SCHEDULED" && companyPays(e));
        return {
          ...p,
          toPay: sum(toPay),
          toPayCount: toPay.length,
          held: p.entries.filter((e) => e.status === "ON_HOLD").length,
          disputed: p.entries.filter((e) => e.dispute?.status === "OPEN").length,
          total: sum(p.entries),
          allPaid: p.entries.every((e) => e.status === "PAID" || e.paidByAdministrator),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [entries]);

  const query = search.trim().toLocaleLowerCase("pt-BR");
  const visiblePeople = query ? people.filter((p) => p.name.toLocaleLowerCase("pt-BR").includes(query)) : people;

  function goTo(target: string) {
    router.push(target === currentMonth ? "/comissoes" : `/comissoes?mes=${target}`);
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function payPerson(beneficiaryId: string) {
    setPaying(beneficiaryId);
    const res = await requestJson("/api/commissions/entries/pay-month", { method: "POST", json: { month, beneficiaryId } });
    setPaying(null);
    if (res.ok) {
      pushUndoToast(res.data?.undo);
      router.refresh();
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Comissões</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/comissoes/vendas" className="btn-secondary">
            <Receipt className="h-4 w-4" strokeWidth={2} />
            Ver vendas
          </Link>
          <Link href="/comissoes/configuracoes" className="btn-secondary">
            <Settings2 className="h-4 w-4" strokeWidth={2} />
            Configurar comissões
          </Link>
        </div>
      </div>

      {!setup.started ? (
        <SetupSteps setup={setup} />
      ) : (
        <>
          <DisputeList disputes={disputes} />

          {(alerts.reviewCount > 0 || alerts.noAdministratorCount > 0 || alerts.overdue) && (
            <div className="space-y-2">
              {alerts.noAdministratorCount > 0 && (
                <AlertLine href="/comissoes/vendas?f=atencao" icon={Building2} action="Escolher agora">
                  {alerts.noAdministratorCount === 1
                    ? "1 venda está sem administradora — sem ela, a comissão não é calculada."
                    : `${alerts.noAdministratorCount} vendas estão sem administradora — sem ela, a comissão não é calculada.`}
                </AlertLine>
              )}
              {alerts.reviewCount > 0 && (
                <AlertLine href="/comissoes/vendas?f=conferir" icon={ClipboardCheck} action="Conferir">
                  {alerts.reviewCount === 1
                    ? "1 venda antiga está esperando você conferir."
                    : `${alerts.reviewCount} vendas antigas estão esperando você conferir.`}
                </AlertLine>
              )}
              {alerts.overdue && alerts.overdue.month !== month && (
                <AlertLine href={`/comissoes?mes=${alerts.overdue.month}`} icon={Clock} action="Ver" tone="danger">
                  {alerts.overdue.count === 1 ? "1 parcela de mês passado ainda não foi paga" : `${alerts.overdue.count} parcelas de meses passados ainda não foram pagas`}{" "}
                  (desde {formatMonthLong(alerts.overdue.month).toLowerCase()}).
                </AlertLine>
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
                  Voltar para este mês
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile
              icon={Wallet}
              tone="brand"
              label="Falta pagar"
              value={formatCurrency(totals.toPay)}
              hint={totals.toPayCount === 0 ? "Nada pendente." : `${totals.toPayCount} ${totals.toPayCount === 1 ? "parcela pronta" : "parcelas prontas"}.`}
            />
            <StatTile
              icon={Lock}
              tone={totals.heldCount > 0 ? "warning" : "neutral"}
              label="Travado"
              value={formatCurrency(totals.held)}
              hint={totals.heldCount === 0 ? "Nada travado." : "Fica de fora do pagamento."}
            />
            <StatTile
              icon={CalendarCheck}
              tone="success"
              label="Já pago"
              value={formatCurrency(totals.paid)}
              hint={totals.direct > 0 ? `Mais ${formatCurrency(totals.direct)} pagos pela administradora.` : undefined}
            />
          </div>

          {expectedRevenue > 0 && (
            <p className="text-sm text-neutral-700 dark:text-neutral-300">
              Em {monthName}, as administradoras devem pagar <strong className="font-semibold text-neutral-900 dark:text-neutral-100">{formatCurrency(expectedRevenue)}</strong>{" "}
              para a corretora. Depois das comissões que a empresa paga ({formatCurrency(totals.companyAll)}), ficam{" "}
              <strong className="font-semibold text-neutral-900 dark:text-neutral-100">{formatCurrency(expectedRevenue - totals.companyAll)}</strong>.
            </p>
          )}

          {people.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={Wallet}
                title={`Nenhuma comissão para ${monthName}`}
                description={
                  month < currentMonth
                    ? "Nenhuma parcela tinha pagamento marcado para este mês."
                    : "Quando uma venda ganha tiver parcela para este mês, ela aparece aqui."
                }
              />
            </div>
          ) : (
            <section className="card p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
                <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Quem recebe em {monthName}</h3>
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
                <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {visiblePeople.map((person) => {
                    const open = expanded.has(person.id);
                    return (
                      <div key={person.id}>
                        <div className="flex items-center gap-3 px-4 py-3">
                          <button type="button" onClick={() => toggle(person.id)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                            <ChevronDown className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${open ? "" : "-rotate-90"}`} strokeWidth={2} />
                            <Avatar name={person.name} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{person.name}</p>
                              <p className="truncate text-sm text-neutral-500 dark:text-neutral-400">
                                {person.entries.length} {person.entries.length === 1 ? "parcela" : "parcelas"}
                                {person.held > 0 && <span className="text-amber-700 dark:text-amber-300">, {person.held} travado{person.held === 1 ? "" : "s"}</span>}
                                {person.disputed > 0 && <span className="text-red-700 dark:text-red-300">, contestou {person.disputed === 1 ? "um valor" : `${person.disputed} valores`}</span>}
                              </p>
                            </div>
                          </button>
                          <div className="flex shrink-0 items-center gap-3">
                            <div className="text-right">
                              <p className="text-sm font-semibold text-neutral-900 tabular-nums dark:text-neutral-100">
                                {formatCurrency(person.toPayCount > 0 ? person.toPay : person.total)}
                              </p>
                              <p className="text-sm text-neutral-500 dark:text-neutral-400">{person.toPayCount > 0 ? "falta pagar" : person.allPaid ? "tudo pago" : "no mês"}</p>
                            </div>
                            {person.toPayCount > 0 ? (
                              <button type="button" className="btn-secondary btn-sm" disabled={paying === person.id} onClick={() => payPerson(person.id)}>
                                {paying === person.id ? <LoadingDots /> : "Pagar"}
                              </button>
                            ) : person.allPaid ? (
                              <CheckCircle2 className="h-5 w-5 text-emerald-500" strokeWidth={2} aria-label="Tudo pago" />
                            ) : (
                              <span className="w-5" />
                            )}
                          </div>
                        </div>
                        {open && (
                          <ul className="divide-y divide-neutral-100 border-t border-neutral-100 bg-neutral-50/50 dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900/30">
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

          <WeightCard weight={weight} />
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

/** Aviso que pede ação — frase inteira + o botão que resolve. */
function AlertLine({
  href,
  icon: Icon,
  action,
  tone = "warning",
  children,
}: {
  href: string;
  icon: typeof AlertTriangle;
  action: string;
  tone?: "warning" | "danger";
  children: React.ReactNode;
}) {
  const colors =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-500/10 dark:text-red-100"
      : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-100";
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${colors}`}>
      <p className="flex items-start gap-2 text-sm">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
        <span>{children}</span>
      </p>
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
    { done: setup.administratorsCount > 0, label: "Cadastrar as administradoras que vocês vendem" },
    { done: setup.rulesCount > 0, label: "Dizer quanto cada um ganha" },
    { done: setup.started, label: "Escolher o mês em que começa a contar" },
  ];
  return (
    <div className="card space-y-4 p-5">
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Vamos configurar as comissões</h2>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">São 3 passos. Os consultores só começam a ver depois do terceiro.</p>
      </div>
      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={step.label} className="flex items-center gap-3">
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
      <Link href="/comissoes/configuracoes" className="btn-primary inline-flex">
        <Settings2 className="h-4 w-4" strokeWidth={2} />
        Começar a configurar
      </Link>
    </div>
  );
}
