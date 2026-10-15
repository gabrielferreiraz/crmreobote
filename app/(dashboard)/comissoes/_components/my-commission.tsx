"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowUpRight, CheckCircle2, ChevronDown, FileText, MessageCircleQuestion, Wallet } from "lucide-react";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { Modal } from "@/components/modal";
import { LoadingDots } from "@/components/loading-dots";
import { requestJson } from "@/lib/client-request";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import { brazilDateKey } from "@/lib/timezone";
import { addMonths, formatMonthLong, formatMonthShort, formatPercent } from "@/lib/commissions/engine";
import { entryDescription, entryDisplayStatus, PAID_BY_ADMINISTRATOR_LABEL } from "@/lib/commissions/ui";
import type { EntryView } from "@/lib/commissions/queries";

const sum = (list: EntryView[]) => list.reduce((acc, e) => acc + e.amount, 0);
const formatDay = (iso: string) => brazilDateKey(new Date(iso)).split("-").reverse().join("/");

/**
 * "Minha comissão" — o que o consultor (ou supervisor/gerente) vê. Só a
 * própria. Em cima, a resposta pra pergunta que ele de fato faz ("quanto
 * eu recebo dia 10?"); depois, a renda já garantida dos próximos meses num
 * gráfico; embaixo, mês a mês, de onde vem cada valor — e cada linha abre
 * a CONTA ("1% de R$ 400.000 do líquido…"), com "Esse valor está errado?"
 * pra contestar direto pro Financeiro, sem WhatsApp.
 */
export function MyCommission({
  entries,
  currentMonth,
  todayDay,
  payDay,
}: {
  entries: EntryView[];
  currentMonth: string;
  todayDay: number;
  payDay: number;
}) {
  const months = useMemo(() => Array.from(new Set(entries.map((e) => e.paymentMonth))).sort(), [entries]);
  const thisMonth = entries.filter((e) => e.paymentMonth === currentMonth && e.status !== "ON_HOLD");
  const held = entries.filter((e) => e.status === "ON_HOLD");
  const future = entries.filter((e) => e.paymentMonth > currentMonth && e.status === "SCHEDULED");
  const [disputeEntry, setDisputeEntry] = useState<EntryView | null>(null);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Minha comissão</h1>

      <Hero thisMonth={thisMonth} currentMonth={currentMonth} todayDay={todayDay} payDay={payDay} />

      {(held.length > 0 || future.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {held.length > 0 && (
            <p className="card flex items-start gap-3 p-4 text-sm text-neutral-700 dark:text-neutral-300">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" strokeWidth={2} />
              <span>
                <strong className="font-semibold text-neutral-900 dark:text-neutral-100">{formatCurrency(sum(held))}</strong> estão travados (
                {held.length} {held.length === 1 ? "parcela" : "parcelas"}). O motivo aparece em amarelo na lista abaixo.
              </span>
            </p>
          )}
          {future.length > 0 && (
            <p className="card flex items-start gap-3 p-4 text-sm text-neutral-700 dark:text-neutral-300">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" strokeWidth={2} />
              <span>
                Você já tem <strong className="font-semibold text-neutral-900 dark:text-neutral-100">{formatCurrency(sum(future))}</strong> garantidos
                para os próximos meses.
              </span>
            </p>
          )}
        </div>
      )}

      {future.length > 0 && <FutureChart entries={entries} currentMonth={currentMonth} />}

      {months.length === 0 ? (
        <div className="card">
          <EmptyState icon={Wallet} title="Nenhuma comissão ainda" description="Quando você ganhar uma venda, a comissão aparece aqui." />
        </div>
      ) : (
        months.map((month, monthIndex) => {
          const rows = entries.filter((e) => e.paymentMonth === month);
          return (
            <section
              key={month}
              id={`mes-${month}`}
              data-help={monthIndex === 0 ? "commission-list" : undefined}
              className="card scroll-mt-20 p-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                  {formatMonthLong(month)}
                  {month === currentMonth && <span className="ml-2 text-sm font-medium text-brand">este mês</span>}
                </h2>
                <div className="flex items-center gap-3">
                  {month <= currentMonth && (
                    <a href={`/comprovante-comissao?mes=${month}`} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm">
                      <FileText className="h-3.5 w-3.5" strokeWidth={2} />
                      Baixar comprovante
                    </a>
                  )}
                  <span className="text-base font-semibold text-neutral-900 tabular-nums dark:text-neutral-100">
                    {formatCurrency(sum(rows.filter((e) => e.status !== "ON_HOLD")))}
                  </span>
                </div>
              </div>
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {rows.map((entry) => (
                  <EntryLine key={entry.id} entry={entry} currentMonth={currentMonth} onDispute={() => setDisputeEntry(entry)} />
                ))}
              </ul>
            </section>
          );
        })
      )}

      {disputeEntry && <DisputeDialog entry={disputeEntry} onClose={() => setDisputeEntry(null)} />}
    </div>
  );
}

/** A resposta pra "quanto eu recebo este mês, e quando?" — um número só, grande. */
function Hero({ thisMonth, currentMonth, todayDay, payDay }: { thisMonth: EntryView[]; currentMonth: string; todayDay: number; payDay: number }) {
  const fromCompany = thisMonth.filter((e) => !e.paidByAdministrator);
  const direct = thisMonth.filter((e) => e.paidByAdministrator);
  const onlyDirect = fromCompany.length === 0 && direct.length > 0;
  const shown = onlyDirect ? direct : fromCompany;
  const total = sum(shown);
  const allPaid = shown.length > 0 && shown.every((e) => e.status === "PAID");
  const monthName = formatMonthLong(currentMonth, { withYear: false }).toLowerCase();
  const daysLeft = payDay - todayDay;

  let title: string;
  let hint: string;
  if (thisMonth.length === 0) {
    title = `Nada para receber em ${monthName}`;
    hint = "Suas próximas comissões aparecem logo abaixo.";
  } else if (onlyDirect) {
    title = `Em ${monthName}, a administradora paga direto para você`;
    hint = "Esse valor não passa pela empresa.";
  } else if (allPaid) {
    title = `Você recebeu em ${monthName}`;
    hint = "Pagamento feito.";
  } else {
    title = `Dia ${payDay} você recebe`;
    hint = daysLeft > 1 ? `Faltam ${daysLeft} dias.` : daysLeft === 1 ? "É amanhã." : daysLeft === 0 ? "É hoje." : "O pagamento deste mês está sendo feito.";
  }
  if (!onlyDirect && direct.length > 0) {
    hint = `${hint} Mais ${formatCurrency(sum(direct))} pagos direto pela administradora.`;
  }

  return (
    <div data-help="commission-hero" className={`card flex items-center gap-4 p-5 ${allPaid ? "ring-1 ring-emerald-500/30" : ""}`}>
      <span
        className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${
          allPaid ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-brand-light text-brand"
        }`}
      >
        {allPaid ? <CheckCircle2 className="h-7 w-7" strokeWidth={2} /> : <Wallet className="h-7 w-7" strokeWidth={2} />}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-neutral-600 dark:text-neutral-400">{title}</p>
        <p className="text-3xl font-semibold tracking-tight text-neutral-900 tabular-nums dark:text-neutral-100">{formatCurrency(total)}</p>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{hint}</p>
      </div>
    </div>
  );
}

/**
 * A renda já garantida dos próximos 12 meses — é o que mais motiva quem vende
 * consórcio com comissão parcelada. Tocar numa barra mostra o valor do mês
 * em cima (sem número espremido embaixo de cada barra) e leva até ele na lista.
 */
function FutureChart({ entries, currentMonth }: { entries: EntryView[]; currentMonth: string }) {
  const months = Array.from({ length: 12 }, (_, i) => addMonths(currentMonth, i));
  const totals = months.map((m) => sum(entries.filter((e) => e.paymentMonth === m && e.status !== "ON_HOLD")));
  const max = Math.max(...totals, 1);
  const [selected, setSelected] = useState(0);

  return (
    <section data-help="commission-chart" className="card space-y-4 p-5">
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Sua comissão nos próximos 12 meses</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {formatMonthLong(months[selected])}: <strong className="font-semibold text-neutral-900 dark:text-neutral-100">{formatCurrency(totals[selected])}</strong>
        </p>
      </div>
      <div className="flex h-36 items-end gap-1.5">
        {months.map((m, i) => (
          <button
            key={m}
            type="button"
            onMouseEnter={() => setSelected(i)}
            onFocus={() => setSelected(i)}
            onClick={() => {
              setSelected(i);
              document.getElementById(`mes-${m}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            aria-label={`${formatMonthLong(m)}: ${formatCurrency(totals[i])}`}
            className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5"
          >
            <span
              className={`w-full rounded-t-md transition-colors ${
                i === selected ? "bg-brand" : totals[i] > 0 ? "bg-brand/30 group-hover:bg-brand/50" : "bg-neutral-100 dark:bg-neutral-800"
              }`}
              style={{ height: `${Math.max(4, (totals[i] / max) * 100)}%` }}
            />
            <span className={`text-[11px] ${i === selected ? "font-semibold text-neutral-900 dark:text-neutral-100" : "text-neutral-500"}`}>
              {formatMonthShort(m).split("/")[0]}
            </span>
          </button>
        ))}
      </div>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Total: <strong className="font-semibold text-neutral-900 dark:text-neutral-100">{formatCurrencyCompact(totals.reduce((a, b) => a + b, 0))}</strong> em 12 meses.
      </p>
    </section>
  );
}

/** Uma linha da lista; tocar abre a conta e as ações (abrir o negócio, contestar). */
function EntryLine({ entry, currentMonth, onDispute }: { entry: EntryView; currentMonth: string; onDispute: () => void }) {
  const [open, setOpen] = useState(false);
  const status = entryDisplayStatus(entry, currentMonth, "seller");
  const isAdjustment = entry.kind === "ADJUSTMENT";
  const subtitle = isAdjustment
    ? entryDescription(entry, { withClient: true })
    : entryDescription(entry, { withAdministrator: true });
  const total = entry.percent != null && entry.baseValue != null ? (entry.baseValue * entry.percent) / 100 : null;

  return (
    <li>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{isAdjustment ? (entry.note ?? "Ajuste") : entry.clientName}</p>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{subtitle}</p>
          {entry.status === "ON_HOLD" && entry.holdReason && (
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2} />
              {entry.holdReason}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex flex-col items-end gap-1">
            <span className={`text-sm font-semibold tabular-nums ${entry.amount < 0 ? "text-red-600 dark:text-red-400" : "text-neutral-900 dark:text-neutral-100"}`}>
              {formatCurrency(entry.amount)}
            </span>
            {entry.paidByAdministrator && entry.status !== "PAID" ? (
              <Badge tone="slate">{PAID_BY_ADMINISTRATOR_LABEL}</Badge>
            ) : (
              <Badge tone={status.tone}>{status.label}</Badge>
            )}
          </div>
          <ChevronDown className={`h-4 w-4 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2} />
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t border-neutral-100 bg-neutral-50/60 px-4 py-3 text-sm text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-300">
          {isAdjustment ? (
            <p>
              Lançamento feito pelo Financeiro{entry.clientName ? ` na venda de ${entry.clientName}` : ""}: <strong className="font-semibold">{entry.note}</strong>.
            </p>
          ) : (
            <>
              <p>
                Venda de <strong className="font-semibold">{entry.clientName}</strong>
                {entry.saleDate ? ` em ${formatDay(entry.saleDate)}` : ""}
                {entry.administratorName ? `, ${entry.administratorName}` : ""}
                {entry.modality === "REDUCED" ? ", em meia parcela" : ""}.
              </p>
              {total != null && entry.percent != null && entry.baseValue != null && (
                <p>
                  A conta: {formatPercent(entry.percent)} de {formatCurrency(entry.baseValue)} (
                  {entry.baseKind === "COMPANY_REVENUE"
                    ? `o que ${entry.administratorName ?? "a administradora"} paga para a corretora por esta venda`
                    : `valor ${entry.baseKind === "GROSS" ? "bruto" : "líquido"} da venda`}
                  ) ={" "}
                  <strong className="font-semibold">{formatCurrency(total)}</strong>
                  {entry.installmentCount && entry.installmentCount > 1 ? `, dividido em ${entry.installmentCount} parcelas.` : "."}
                </p>
              )}
              {entry.paidByAdministrator && <p>Esta parcela quem paga é a administradora, direto para você.</p>}
            </>
          )}

          {entry.dispute?.status === "OPEN" && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
              Você contestou em {formatDay(entry.dispute.createdAt)}: “{entry.dispute.message}”. Aguardando o Financeiro.
            </p>
          )}
          {entry.dispute?.status === "RESOLVED" && entry.dispute.response && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100">
              Resposta do Financeiro: “{entry.dispute.response}”
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {entry.dealId && (
              <Link href={`/negocios/${entry.dealId}`} className="btn-secondary btn-sm">
                Abrir o negócio
                <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
              </Link>
            )}
            {entry.dispute?.status !== "OPEN" && (
              <button type="button" className="btn-secondary btn-sm" onClick={onDispute}>
                <MessageCircleQuestion className="h-3.5 w-3.5" strokeWidth={2} />
                Esse valor está errado?
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

const DISPUTE_REASONS = ["O valor da venda está errado", "A administradora está errada", "Era meia parcela", "Está faltando uma parcela"];

function DisputeDialog({ entry, onClose }: { entry: EntryView; onClose: () => void }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setSaving(true);
    const res = await requestJson("/api/commissions/disputes", { method: "POST", json: { entryId: entry.id, message: message.trim() } }, { silent: true });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Modal onClose={() => !saving && onClose()} maxWidth="max-w-md">
      <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">O que está errado?</h2>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        {entry.clientName ? `${entry.clientName}, ` : ""}
        {formatCurrency(entry.amount)}. O Financeiro recebe sua mensagem e responde por aqui.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {DISPUTE_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setMessage(r)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                message === r
                  ? "border-brand bg-brand-light text-brand"
                  : "border-neutral-200 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <textarea
          className="field-input min-h-24"
          value={message}
          maxLength={500}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Conte com suas palavras"
          aria-label="O que está errado"
        />
        {error && <p className="field-error text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !message.trim()}>
            {saving ? <LoadingDots /> : "Enviar para o Financeiro"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
