"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, Loader2 } from "lucide-react";
import type { ServopaTableListView, ServopaTableRowView } from "@/lib/servopa-tables/queries";
import { formatBRL, formatPercent, SEGMENT_LABEL } from "@/lib/servopa-tables/format";

/** Como a lista chega pelo JSON: as datas viram texto na serialização. */
type TableItem = Omit<ServopaTableListView, "nextAssemblyAt"> & { nextAssemblyAt: string | null };

type TableDetail = {
  id: string;
  groupNumber: string;
  segment: "REAL_ESTATE" | "MOVABLE";
  termMonths: number;
  admEffective: string;
  rows: ServopaTableRowView[];
};

/** O que o campo recebe de volta: os três campos da cota, já conferidos. */
export type QuotaPick = { groupNumber: string; termMonths: number; creditValue: number };

/**
 * A lista das tabelas da Servopa embaixo do campo Grupo da cota vendida.
 *
 * Por que uma lista e não digitação livre: na Servopa o grupo, o prazo e o
 * valor do crédito JÁ existem conferidos dentro do CRM (ver
 * memory-tabelas-servopa.md). Digitar à mão os três é só chance de errar —
 * aqui a pessoa escolhe o grupo, depois o crédito daquele grupo, e os três
 * campos são preenchidos juntos.
 *
 * São duas etapas porque a lista (`/api/tabelas`) traz só a FAIXA de crédito
 * de cada tabela; os valores um a um vivem no detalhe (`/api/tabelas/{id}`),
 * que é exatamente "os valores daquele em específico". Assim também não se
 * baixa as 2.928 linhas para escolher um grupo.
 *
 * Somente leitura: nada daqui altera tabela nem ajuste de taxa.
 */
export function ServopaQuotaPicker({
  query,
  onPick,
  onClose,
}: {
  /** O que já está digitado no campo Grupo: filtra a lista pelo começo do número. */
  query: string;
  onPick: (pick: QuotaPick) => void;
  onClose: () => void;
}) {
  const [tables, setTables] = useState<TableItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** Tabela escolhida na 1ª etapa (null = ainda escolhendo o grupo). */
  const [chosen, setChosen] = useState<TableItem | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let done = false;
    fetch("/api/tabelas", { signal: controller.signal, headers: { Accept: "application/json" } })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { tables?: TableItem[]; error?: string } | null;
        done = true;
        if (!res.ok || !body?.tables) throw new Error(body?.error ?? "Não foi possível carregar as tabelas.");
        setTables(body.tables);
      })
      .catch((err: unknown) => {
        done = true;
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Não foi possível carregar as tabelas.");
      });
    // Com MOTIVO e só se ainda estiver em voo: um `abort()` pelado vira
    // "signal is aborted without reason" no painel de erro do dev, porque o
    // StrictMode monta, desmonta e monta de novo.
    return () => {
      if (!done) controller.abort(new DOMException("Consulta de tabelas cancelada: a lista fechou.", "AbortError"));
    };
  }, [attempt]);

  const digits = query.replace(/\D/g, "");
  const visible = useMemo(() => {
    const list = (tables ?? []).filter((t) => !digits || t.groupNumber.startsWith(digits));
    return [...list].sort((a, b) => a.groupNumber.localeCompare(b.groupNumber) || a.termMonths - b.termMonths);
  }, [tables, digits]);

  return (
    <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
      {chosen ? (
        <CreditList table={chosen} onBack={() => setChosen(null)} onPick={onPick} />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
            <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
              {tables ? `${visible.length} ${visible.length === 1 ? "tabela" : "tabelas"} da Servopa` : "Tabelas da Servopa"}
            </p>
            <button type="button" onClick={onClose} className="text-xs font-medium text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
              Fechar
            </button>
          </div>

          {!tables && !error && (
            <div className="flex items-center justify-center gap-2.5 py-10 text-sm text-neutral-500 dark:text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
              Carregando os grupos…
            </div>
          )}

          {error && <Retry message={error} onRetry={() => { setError(null); setAttempt((n) => n + 1); }} />}

          {tables && visible.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
              {digits ? `Nenhum grupo começando por ${digits}.` : "Nenhuma tabela publicada."}
            </p>
          )}

          {tables && visible.length > 0 && (
            <ul className="scrollbar-thin max-h-72 overflow-y-auto">
              {visible.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    // O mousedown do botão tiraria o foco do campo antes do
                    // clique, e a lista fecharia sem escolher nada.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setChosen(t)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        Grupo {t.groupNumber}
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.segment === "REAL_ESTATE" ? "bg-emerald-500" : "bg-sky-500"}`}
                          aria-hidden="true"
                        />
                        <span className="text-xs font-normal text-neutral-500 dark:text-neutral-400">{SEGMENT_LABEL[t.segment]}</span>
                      </span>
                      <span className="mt-0.5 block text-xs text-neutral-500 tabular-nums dark:text-neutral-400">
                        {t.termMonths} meses · ADM {formatPercent(t.admEffective, { trim: true })}
                        {t.vacancies !== null && ` · ${t.vacancies} ${t.vacancies === 1 ? "vaga" : "vagas"}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-xs tabular-nums text-neutral-600 dark:text-neutral-300">
                      {t.creditRange.min === t.creditRange.max ? (
                        formatBRL(t.creditRange.min)
                      ) : (
                        <>
                          <span className="block font-medium text-neutral-900 dark:text-neutral-100">{formatBRL(t.creditRange.min)}</span>
                          <span className="block text-neutral-400">até {formatBRL(t.creditRange.max)}</span>
                        </>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** 2ª etapa: os créditos daquela tabela, um a um (é o que o PDF imprime). */
function CreditList({ table, onBack, onPick }: { table: TableItem; onBack: () => void; onPick: (pick: QuotaPick) => void }) {
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let done = false;
    fetch(`/api/tabelas/${table.id}`, { signal: controller.signal, headers: { Accept: "application/json" } })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { table?: TableDetail; error?: string } | null;
        done = true;
        if (!res.ok || !body?.table) throw new Error(body?.error ?? "Não foi possível carregar a tabela.");
        setDetail(body.table);
      })
      .catch((err: unknown) => {
        done = true;
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Não foi possível carregar a tabela.");
      });
    return () => {
      if (!done) controller.abort(new DOMException("Consulta da tabela cancelada: você voltou para a lista.", "AbortError"));
    };
  }, [table.id, attempt]);

  return (
    <>
      <div className="flex items-center gap-2 border-b border-neutral-100 px-2 py-2 dark:border-neutral-800">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
          Grupos
        </button>
        <p className="min-w-0 truncate text-xs font-semibold text-neutral-900 dark:text-neutral-100">
          Grupo {table.groupNumber} · {table.termMonths} meses
        </p>
      </div>

      {!detail && !error && (
        <div className="flex items-center justify-center gap-2.5 py-10 text-sm text-neutral-500 dark:text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
          Carregando os créditos…
        </div>
      )}

      {error && <Retry message={error} onRetry={() => { setError(null); setAttempt((n) => n + 1); }} />}

      {detail && (
        <ul className="scrollbar-thin max-h-72 overflow-y-auto">
          {detail.rows.map((row) => (
            <li key={row.position}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  onPick({
                    groupNumber: detail.groupNumber,
                    termMonths: detail.termMonths,
                    creditValue: Number(row.creditValue),
                  })
                }
                className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                    {formatBRL(row.creditValue)}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-neutral-500 dark:text-neutral-400">
                    Categoria {row.category}
                    {row.description ? ` · ${row.description}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                  parcela {formatBRL(row.installment)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Retry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="px-3 py-8 text-center">
      <AlertTriangle className="mx-auto h-6 w-6 text-amber-500" strokeWidth={1.8} />
      <p className="mt-2 text-sm font-medium text-neutral-800 dark:text-neutral-200">{message}</p>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onRetry} className="btn-secondary btn-sm mt-3">
        Tentar de novo
      </button>
    </div>
  );
}
