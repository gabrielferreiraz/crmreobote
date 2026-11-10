"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ClipboardCheck, FileText, Hourglass, Search, ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency } from "@/lib/format";

export type CadastroRow = {
  id: string;
  client: string;
  consultant: string;
  administrator: string | null;
  credit: number | null;
  closedAt: string | null;
  state: "ready" | "waiting" | "done";
  answered: boolean;
  waitingFor: string | null;
  docs: number;
  docsExpireAt: string | null;
  docsPurged: boolean;
  waived: boolean;
  quotaAt: string | null;
};

type Tab = "ready" | "waiting" | "done" | "all";
const TABS: { key: Tab; label: string }[] = [
  { key: "ready", label: "Para cadastrar" },
  { key: "waiting", label: "Aguardando consultor" },
  { key: "done", label: "Cadastradas" },
  { key: "all", label: "Todas" },
];

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Campo_Grande" }) : "—");

function daysLeft(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function CadastrosList({ rows, doneTotal }: { rows: CadastroRow[]; doneTotal: number }) {
  const [tab, setTab] = useState<Tab>("ready");
  const [q, setQ] = useState("");

  const counts = useMemo(
    () => ({
      ready: rows.filter((r) => r.state === "ready").length,
      waiting: rows.filter((r) => r.state === "waiting").length,
      done: doneTotal,
      all: rows.filter((r) => r.state !== "done").length + doneTotal,
    }),
    [rows, doneTotal],
  );

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = rows.filter(
      (r) => (tab === "all" || r.state === tab) && (!term || r.client.toLowerCase().includes(term) || r.consultant.toLowerCase().includes(term)),
    );
    // Pendentes: a venda mais antiga primeiro (fila); cadastradas: as mais recentes.
    const dir = tab === "done" ? -1 : 1;
    return [...list].sort((a, b) => dir * (a.closedAt ?? "").localeCompare(b.closedAt ?? ""));
  }, [rows, tab, q]);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center gap-3.5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand shadow-sm shadow-brand/30">
          <ClipboardCheck className="h-6 w-6 text-white" strokeWidth={2} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Cadastros</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Vendas ganhas esperando a cota ser cadastrada na administradora.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="flex flex-wrap gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800/70">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t.key ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100" : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400"
              }`}
            >
              {t.label} <span className="tabular-nums text-neutral-400">{counts[t.key]}</span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input className="field-input pl-9" placeholder="Buscar cliente ou consultor" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={ClipboardCheck}
            title={tab === "ready" ? "Nada para cadastrar agora" : "Nenhuma venda aqui"}
            description={q ? "Nenhum resultado para essa busca." : "Quando um consultor marcar uma venda como ganha, ela aparece aqui."}
          />
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((r) => {
            const left = r.docsExpireAt && r.state !== "done" && r.docs > 0 ? daysLeft(r.docsExpireAt) : null;
            const Icon = r.state === "done" ? CheckCircle2 : r.state === "waiting" ? Hourglass : FileText;
            return (
              <li key={r.id}>
                <Link href={`/cadastros/${r.id}`} className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-3.5 transition-shadow hover:shadow-md sm:p-4">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      r.state === "done"
                        ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
                        : r.state === "waiting"
                          ? "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400"
                          : "bg-brand-light text-brand"
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{r.client}</p>
                    <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                      {[r.administrator, r.credit != null ? formatCurrency(r.credit) : null, `Consultor: ${r.consultant}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
                    {r.state === "waiting" && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">Esperando: {r.waitingFor}</span>
                    )}
                    {r.answered && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">Consultor respondeu</span>}
                    {r.waived && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                        <ShieldAlert className="h-3 w-3" /> Sem cadastro completo
                      </span>
                    )}
                    {left != null && (
                      <span
                        className={`rounded-full px-2 py-0.5 ${
                          left <= 2 ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                        }`}
                      >
                        {left <= 0 ? "Baixe hoje" : `Baixar em ${left} ${left === 1 ? "dia" : "dias"}`}
                      </span>
                    )}
                    {r.docs === 0 && r.state !== "done" && !r.docsPurged && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700 dark:bg-red-500/10 dark:text-red-400">Sem documentos</span>
                    )}
                  </div>
                  <span className="w-20 text-right text-xs text-neutral-500 dark:text-neutral-400">{r.state === "done" ? fmt(r.quotaAt) : fmt(r.closedAt)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {(tab === "done" || tab === "all") && doneTotal > rows.filter((r) => r.state === "done").length && (
        <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">Mostrando as 150 cadastradas mais recentes.</p>
      )}
    </div>
  );
}
