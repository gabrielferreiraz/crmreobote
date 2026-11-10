"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Files,
  FileWarning,
  Hourglass,
  ListFilter,
  Search,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency } from "@/lib/format";

export type CadastroRow = {
  id: string;
  client: string;
  /** "Grupo 1568 · Cota 0123-00" — vazio enquanto o administrativo não preencheu. */
  quotaLabel: string;
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
const TABS: { key: Tab; label: string; hint: string; icon: LucideIcon }[] = [
  { key: "ready", label: "Para cadastrar", hint: "Prontas para ação", icon: ClipboardCheck },
  { key: "waiting", label: "Aguardando consultor", hint: "Com pendência externa", icon: Hourglass },
  { key: "done", label: "Cadastradas", hint: "Concluídas", icon: CheckCircle2 },
  { key: "all", label: "Todas", hint: "Visão completa", icon: ListFilter },
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
      (r) => (tab === "all" || r.state === tab) && (!term || r.client.toLowerCase().includes(term) || r.consultant.toLowerCase().includes(term) || r.quotaLabel.toLowerCase().includes(term)),
    );
    // Pendentes: a venda mais antiga primeiro (fila); cadastradas: as mais recentes.
    const dir = tab === "done" ? -1 : 1;
    return [...list].sort((a, b) => dir * (a.closedAt ?? "").localeCompare(b.closedAt ?? ""));
  }, [rows, tab, q]);

  const activeTab = TABS.find((item) => item.key === tab)!;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex items-center gap-3.5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand shadow-sm shadow-brand/30">
          <ClipboardCheck className="h-6 w-6 text-white" strokeWidth={2} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Cadastros</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Vendas ganhas esperando a cota ser cadastrada na administradora.</p>
        </div>
      </div>

      <div role="tablist" className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200 lg:grid-cols-4 dark:border-neutral-800 dark:bg-neutral-800">
        {TABS.map((item) => {
          const Icon = item.icon;
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.key)}
              className={`flex min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors ${
                active
                  ? "bg-brand-light text-brand dark:bg-[var(--brand-subtle)]"
                  : "bg-white text-neutral-600 hover:bg-neutral-50 dark:bg-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-900"
              }`}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${active ? "bg-white/80 dark:bg-white/10" : "bg-neutral-100 dark:bg-neutral-800"}`}>
                <Icon className="h-4 w-4" strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{item.label}</span>
                <span className={`block truncate text-xs ${active ? "text-brand/75" : "text-neutral-400 dark:text-neutral-500"}`}>{item.hint}</span>
              </span>
              <strong className="shrink-0 text-xl font-semibold tabular-nums">{counts[item.key]}</strong>
            </button>
          );
        })}
      </div>

      <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex flex-col gap-3 border-b border-neutral-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-neutral-800">
          <div>
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{activeTab.label}</h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {visible.length} {visible.length === 1 ? "cadastro exibido" : "cadastros exibidos"}
            </p>
          </div>
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input className="field-input pl-9" placeholder="Buscar cliente, consultor ou grupo" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title={tab === "ready" ? "Nada para cadastrar agora" : "Nenhuma venda aqui"}
            description={q ? "Nenhum resultado para essa busca." : "Quando um consultor marcar uma venda como ganha, ela aparece aqui."}
          />
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(260px,1.4fr)_150px_170px_minmax(220px,1fr)_110px_24px] gap-4 border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-[11px] font-semibold text-neutral-500 lg:grid dark:border-neutral-800 dark:bg-neutral-900/70 dark:text-neutral-400">
              <span>Cliente e venda</span>
              <span>Crédito</span>
              <span>Consultor</span>
              <span>Documentos</span>
              <span>{tab === "done" ? "Conclusão" : "Entrada"}</span>
              <span />
            </div>
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {visible.map((row) => {
                const left = row.docsExpireAt && row.state !== "done" && row.docs > 0 ? daysLeft(row.docsExpireAt) : null;
                const StateIcon = row.state === "done" ? CheckCircle2 : row.state === "waiting" ? Hourglass : ClipboardCheck;
                const stateLabel = row.state === "done" ? "Cota cadastrada" : row.state === "waiting" ? "Aguardando retorno" : "Cadastro pendente";
                const DocumentIcon = row.docs > 0 ? Files : FileWarning;
                const documentLabel = row.docsPurged
                  ? "Arquivos removidos"
                  : row.docs === 0
                    ? "Sem documentos"
                    : `${row.docs} ${row.docs === 1 ? "documento" : "documentos"}`;
                const documentNote = row.state === "waiting"
                  ? `Aguardando: ${row.waitingFor ?? "consultor"}`
                  : row.answered
                    ? "Consultor respondeu"
                    : row.docsPurged
                      ? "Prazo de retenção encerrado"
                      : row.docs === 0 && row.state !== "done"
                        ? "Solicite ao consultor"
                        : left != null
                          ? left <= 0
                            ? "Baixar hoje"
                            : `Baixar em ${left} ${left === 1 ? "dia" : "dias"}`
                          : "Disponíveis para conferência";
                const documentTone = row.state === "waiting"
                  ? "text-amber-600 dark:text-amber-400"
                  : row.answered
                    ? "text-emerald-600 dark:text-emerald-400"
                    : row.docs === 0 && row.state !== "done"
                      ? "text-red-600 dark:text-red-400"
                      : left != null && left <= 2
                        ? "text-red-600 dark:text-red-400"
                        : "text-neutral-500 dark:text-neutral-400";

                return (
                  <li key={row.id}>
                    <Link
                      href={`/cadastros/${row.id}`}
                      className="group grid gap-3 px-4 py-4 transition-colors hover:bg-neutral-50 sm:grid-cols-2 lg:grid-cols-[minmax(260px,1.4fr)_150px_170px_minmax(220px,1fr)_110px_24px] lg:items-center lg:gap-4 dark:hover:bg-neutral-900/70"
                    >
                      <div className="flex min-w-0 items-start gap-3 sm:col-span-2 lg:col-span-1">
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                            row.state === "done"
                              ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
                              : row.state === "waiting"
                                ? "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400"
                                : "bg-brand-light text-brand dark:bg-[var(--brand-subtle)]"
                          }`}
                        >
                          <StateIcon className="h-[18px] w-[18px]" strokeWidth={2} />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{row.client}</p>
                          <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                            {[row.administrator, row.quotaLabel || null].filter(Boolean).join(" · ") || "Administradora não informada"}
                          </p>
                          <p className="mt-1 text-[11px] font-medium text-neutral-400 dark:text-neutral-500">{stateLabel}</p>
                        </div>
                      </div>

                      <div className="min-w-0">
                        <p className="mb-0.5 text-[11px] font-medium text-neutral-400 lg:hidden">Crédito</p>
                        <p className="truncate text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                          {row.credit != null ? formatCurrency(row.credit) : "Não informado"}
                        </p>
                      </div>

                      <div className="min-w-0">
                        <p className="mb-0.5 text-[11px] font-medium text-neutral-400 lg:hidden">Consultor</p>
                        <p className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">{row.consultant}</p>
                      </div>

                      <div className="min-w-0 sm:col-span-2 lg:col-span-1">
                        <p className="mb-0.5 text-[11px] font-medium text-neutral-400 lg:hidden">Documentos</p>
                        <div className="flex items-center gap-1.5 text-sm font-medium text-neutral-800 dark:text-neutral-200">
                          <DocumentIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={2} />
                          <span className="truncate">{documentLabel}</span>
                        </div>
                        <p className={`mt-0.5 truncate text-xs ${documentTone}`}>{documentNote}</p>
                        {row.waived && (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                            <ShieldAlert className="h-3 w-3 shrink-0" /> Sem cadastro completo
                          </p>
                        )}
                      </div>

                      <div className="min-w-0">
                        <p className="mb-0.5 text-[11px] font-medium text-neutral-400 lg:hidden">{row.state === "done" ? "Cadastrada em" : "Venda ganha em"}</p>
                        <p className="text-sm tabular-nums text-neutral-600 dark:text-neutral-300">{row.state === "done" ? fmt(row.quotaAt) : fmt(row.closedAt)}</p>
                      </div>

                      <ChevronRight className="hidden h-4 w-4 text-neutral-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand lg:block dark:text-neutral-600" strokeWidth={2} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {(tab === "done" || tab === "all") && doneTotal > rows.filter((r) => r.state === "done").length && (
        <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">Mostrando as 150 cadastradas mais recentes.</p>
      )}
    </div>
  );
}
