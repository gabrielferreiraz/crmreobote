"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronDown, Search, Sparkles, UserRound, Users, X } from "lucide-react";
import { LoadingDots } from "@/components/loading-dots";
import { memberMatcher, type Member } from "@/lib/sheets/member-match";

export type InvalidValue = { value: string; count: number };

type Tab = "todo" | "done" | "all";

/**
 * "Quem é quem?" — etapa própria do diálogo ao converter Texto → Membro da equipe.
 * Cada nome diferente da coluna ("FRED", "EDU/FELIPE"…) recebe um ou mais membros;
 * vale para todas as células com aquele nome. Já vem sugerido pelos nomes da equipe;
 * a pessoa só resolve o que falta (aba "Faltam escolher", a primeira).
 */
export function MemberMapping({
  columnName,
  values,
  totalInvalid,
  multiple,
  saving,
  error,
  onToggleMultiple,
  onApply,
  onClearAll,
  onBack,
}: {
  columnName: string;
  values: InvalidValue[];
  /** Células que não casaram no total (pode passar da soma de `values`, que vem limitada). */
  totalInvalid: number;
  multiple: boolean;
  saving: boolean;
  error: string | null;
  onToggleMultiple: (on: boolean) => void;
  /** valueMap só com os nomes que têm membro; `clearRest` = limpar as células sem membro. */
  onApply: (valueMap: Record<string, string[]>, clearRest: boolean) => void;
  /** Sem "De → Para": só limpa as células que não são membro (o jeito antigo). */
  onClearAll: () => void;
  onBack: () => void;
}) {
  const [members, setMembers] = useState<(Member & { inactive: boolean })[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Só o que a pessoa mudou; o resto segue a sugestão automática.
  const [overrides, setOverrides] = useState<Record<string, string[]>>({});
  const [tab, setTab] = useState<Tab>("todo");
  const [filter, setFilter] = useState("");
  const [picking, setPicking] = useState<string | null>(null);
  const [pickQuery, setPickQuery] = useState("");
  const [shown, setShown] = useState(100);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/sheets/lookup?type=USER&all=1")
      .then((res) => res.json())
      .then((data: { items?: { id: string; label: string; inactive?: boolean }[] }) => {
        if (alive) setMembers((data.items ?? []).map((m) => ({ id: m.id, label: m.label, inactive: !!m.inactive })));
      })
      .catch(() => alive && setLoadError("Não foi possível carregar a equipe. Feche e tente de novo."));
    return () => {
      alive = false;
    };
  }, []);

  const byId = useMemo(() => new Map((members ?? []).map((m) => [m.id, m.label])), [members]);
  const inactiveIds = useMemo(() => new Set((members ?? []).filter((m) => m.inactive).map((m) => m.id)), [members]);
  const suggested = useMemo(() => {
    if (!members) return new Map<string, string[]>();
    // Prefere quem está ativo; só recorre a inativos quando nenhum ativo bate (nome igual entre ativo e ex-consultor não vira ambíguo).
    const active = memberMatcher(members.filter((m) => !m.inactive));
    const everyone = memberMatcher(members);
    return new Map(
      values.map((v) => {
        const a = active(v.value);
        if (a.ids.length && !a.unresolved.length) return [v.value, a.ids];
        const e = everyone(v.value);
        return [v.value, e.ids.length > a.ids.length ? e.ids : a.ids];
      }),
    );
  }, [members, values]);

  const idsOf = (value: string) => overrides[value] ?? suggested.get(value) ?? [];
  const setIds = (value: string, ids: string[]) => setOverrides((o) => ({ ...o, [value]: ids }));
  const isAuto = (value: string) => !overrides[value] && (suggested.get(value)?.length ?? 0) > 0;

  const doneValues = values.filter((v) => idsOf(v.value).length);
  const todoValues = values.filter((v) => !idsOf(v.value).length);
  const mappedCells = doneValues.reduce((n, v) => n + v.count, 0);
  const unmappedCells = Math.max(0, totalInvalid - mappedCells);
  const splitValues = values.filter((v) => idsOf(v.value).length > 1);
  const blockedBySplit = !multiple && splitValues.length > 0;
  const pct = totalInvalid ? Math.round((mappedCells / totalInvalid) * 100) : 0;

  const list = useMemo(() => {
    const base = tab === "todo" ? todoValues : tab === "done" ? doneValues : values;
    const q = filter.trim().toLowerCase();
    return q ? base.filter((v) => v.value.toLowerCase().includes(q)) : base;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- todo/done derivam de values+overrides+suggested
  }, [tab, filter, values, overrides, suggested]);

  const pickList = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    return (members ?? []).filter((m) => !q || m.label.toLowerCase().includes(q)).slice(0, 80);
  }, [members, pickQuery]);

  function choose(value: string, id: string) {
    const ids = idsOf(value);
    if (multiple) setIds(value, ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
    else {
      setIds(value, [id]);
      setPicking(null);
    }
  }

  function apply() {
    const map: Record<string, string[]> = {};
    for (const v of doneValues) map[v.value] = idsOf(v.value);
    onApply(map, unmappedCells > 0);
  }

  const tabs: { id: Tab; label: string; n: number }[] = [
    { id: "todo", label: "Faltam escolher", n: todoValues.length },
    { id: "done", label: "Já definidos", n: doneValues.length },
    { id: "all", label: "Todos", n: values.length },
  ];

  return (
    <div className="flex max-h-[85vh] flex-col">
      {/* Cabeçalho */}
      <div className="space-y-3 border-b border-neutral-200 px-6 pt-5 pb-4 dark:border-neutral-800">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar para a configuração
        </button>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
            <Users className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Quem é quem na coluna “{columnName}”?</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Encontramos <b className="text-neutral-800 dark:text-neutral-200">{values.length.toLocaleString("pt-BR")} nomes</b> diferentes. Diga qual membro da equipe é cada um —
              vale para todas as células com aquele nome.
            </p>
          </div>
        </div>

        {/* Progresso */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-neutral-700 dark:text-neutral-300">
              {mappedCells.toLocaleString("pt-BR")} de {totalInvalid.toLocaleString("pt-BR")} células já têm membro
            </span>
            <span className="text-neutral-500">{pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
            <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          {members && doneValues.some((v) => isAuto(v.value)) && (
            <p className="flex items-center gap-1 text-xs text-neutral-500">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" /> Já preenchemos sozinhos os nomes que batem com a equipe — confira em “Já definidos”.
            </p>
          )}
        </div>

        {/* Venda dividida */}
        {(blockedBySplit || multiple) && (
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm ${
              blockedBySplit ? "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10" : "border-neutral-200 dark:border-neutral-800"
            }`}
          >
            <input type="checkbox" checked={multiple} onChange={(e) => onToggleMultiple(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" />
            <span>
              <span className="block font-medium text-neutral-800 dark:text-neutral-200">Uma venda pode ter mais de um consultor</span>
              <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                {blockedBySplit
                  ? `${splitValues.length} nome(s) dividem a venda (ex.: ${splitValues[0].value}). Marque para guardar todos os consultores.`
                  : "Ex.: EDU/FELIPE guarda os dois — e a venda conta para cada um no filtro e no resumo."}
              </span>
            </span>
          </label>
        )}

        {/* Abas + busca */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-neutral-100 p-0.5 text-xs dark:bg-neutral-800">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  setShown(100);
                }}
                className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                  tab === t.id ? "bg-white text-neutral-900 shadow-xs dark:bg-neutral-900 dark:text-neutral-100" : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                }`}
              >
                {t.label} <span className={t.id === "todo" && t.n > 0 ? "text-amber-600" : "text-neutral-400"}>{t.n}</span>
              </button>
            ))}
          </div>
          <span className="relative min-w-40 flex-1">
            <Search className="absolute top-2.5 left-2.5 h-3.5 w-3.5 text-neutral-400" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Procurar um nome…" className="field-input w-full py-1.5 pl-8 text-sm" />
          </span>
        </div>
      </div>

      {/* Lista */}
      <div className="min-h-48 flex-1 overflow-auto px-6 py-2">
        {loadError && <p className="py-6 text-center text-sm text-red-600">{loadError}</p>}
        {!members && !loadError && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-500">
            <LoadingDots /> Carregando a equipe…
          </div>
        )}
        {members && list.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-neutral-500">
            {tab === "todo" ? (
              <>
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  <Check className="h-5 w-5" />
                </span>
                Tudo certo — todos os nomes já têm membro.
              </>
            ) : (
              "Nenhum nome aqui."
            )}
          </div>
        )}
        {members && list.length > 0 && (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3 border-b border-neutral-100 pb-1.5 text-[11px] font-semibold tracking-wide text-neutral-400 uppercase dark:border-neutral-800">
              <span>Na planilha está</span>
              <span>Membro da equipe</span>
            </div>
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {list.slice(0, shown).map((v) => {
                const ids = idsOf(v.value);
                const open = picking === v.value;
                return (
                  <li key={v.value} className="py-2">
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100" title={v.value}>
                          {v.value}
                        </p>
                        <p className="text-xs text-neutral-400">
                          {v.count.toLocaleString("pt-BR")} {v.count === 1 ? "célula" : "células"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setPicking(open ? null : v.value);
                          setPickQuery("");
                        }}
                        className={`flex min-h-9 w-full items-center gap-1.5 rounded-lg border px-2.5 py-1 text-left text-sm transition-colors ${
                          open
                            ? "border-brand ring-2 ring-brand/20"
                            : ids.length
                              ? "border-neutral-200 bg-white hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900"
                              : "border-dashed border-neutral-300 bg-neutral-50 text-neutral-400 hover:border-brand hover:text-brand dark:border-neutral-600 dark:bg-neutral-900/50"
                        }`}
                      >
                        {ids.length ? (
                          <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                            {ids.map((id) => (
                              <span key={id} className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                                <UserRound className="h-3 w-3 shrink-0" />
                                <span className="truncate">{byId.get(id) ?? "Membro"}</span>
                                {inactiveIds.has(id) && <span className="shrink-0 font-normal text-neutral-400">(inativo)</span>}
                              </span>
                            ))}
                            {isAuto(v.value) && <span className="self-center text-[10px] text-neutral-400">sugerido</span>}
                          </span>
                        ) : (
                          <span className="flex-1">Escolher membro…</span>
                        )}
                        <ChevronDown className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} />
                      </button>
                    </div>
                    {open && (
                      <div className="mt-2 ml-auto w-full rounded-lg border border-neutral-200 bg-white p-2 shadow-sm sm:w-[56.5%] dark:border-neutral-700 dark:bg-neutral-900">
                        <span className="relative block">
                          <Search className="absolute top-2 left-2 h-3.5 w-3.5 text-neutral-400" />
                          <input
                            autoFocus
                            value={pickQuery}
                            onChange={(e) => setPickQuery(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setPicking(null);
                              if (e.key === "Enter" && pickList[0]) choose(v.value, pickList[0].id);
                            }}
                            placeholder="Digite o nome do membro…"
                            className="field-input w-full py-1.5 pl-7 text-sm"
                          />
                        </span>
                        <div className="mt-1 max-h-48 overflow-auto">
                          {pickList.map((m) => {
                            const on = ids.includes(m.id);
                            return (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => choose(v.value, m.id)}
                                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${on ? "font-medium text-brand" : "text-neutral-800 dark:text-neutral-200"}`}
                              >
                                <span className={`flex h-4 w-4 shrink-0 items-center justify-center ${multiple ? "rounded border" : "rounded-full border"} ${on ? "border-brand bg-brand text-white" : "border-neutral-300 dark:border-neutral-600"}`}>
                                  {on && <Check className="h-3 w-3" />}
                                </span>
                                <span className="truncate">{m.label}</span>
                                {m.inactive && <span className="ml-auto shrink-0 rounded bg-neutral-100 px-1.5 text-[10px] text-neutral-500 dark:bg-neutral-800">Inativo</span>}
                              </button>
                            );
                          })}
                          {!pickList.length && <p className="px-2 py-2 text-sm text-neutral-400">Ninguém da equipe com esse nome.</p>}
                        </div>
                        <div className="mt-1 flex items-center justify-between border-t border-neutral-100 pt-1.5 text-xs dark:border-neutral-800">
                          <button type="button" onClick={() => setIds(v.value, [])} className="text-neutral-500 hover:text-red-600" disabled={!ids.length}>
                            <X className="mr-0.5 inline h-3 w-3" />
                            Deixar sem membro
                          </button>
                          {multiple && (
                            <button type="button" onClick={() => setPicking(null)} className="font-medium text-brand">
                              Pronto
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {list.length > shown && (
              <button type="button" className="my-2 w-full rounded-lg py-2 text-sm font-medium text-brand hover:bg-brand/5" onClick={() => setShown((n) => n + 100)}>
                Mostrar mais {(list.length - shown).toLocaleString("pt-BR")} nomes
              </button>
            )}
          </>
        )}
      </div>

      {/* Rodapé */}
      <div className="space-y-2 border-t border-neutral-200 bg-neutral-50/80 px-6 py-3.5 dark:border-neutral-800 dark:bg-neutral-900/60">
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {unmappedCells > 0 && members && (
          <p className="text-xs text-neutral-500">
            {todoValues.length > 0 ? `${todoValues.length} nome(s) sem membro — ` : ""}
            {unmappedCells.toLocaleString("pt-BR")} célula(s) ficarão em branco. Você pode preencher depois, célula por célula.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {confirmClear ? (
            <span className="flex items-center gap-2 text-xs">
              Apagar as {totalInvalid.toLocaleString("pt-BR")} células sem converter nenhuma?
              <button type="button" className="font-semibold text-red-600 hover:underline" disabled={saving} onClick={onClearAll}>
                Sim, apagar
              </button>
              <button type="button" className="text-neutral-500 hover:underline" onClick={() => setConfirmClear(false)}>
                Não
              </button>
            </span>
          ) : (
            <button type="button" className="text-xs text-neutral-500 hover:text-red-600" onClick={() => setConfirmClear(true)}>
              Prefiro apagar esses nomes
            </button>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={onBack}>
              Cancelar
            </button>
            <button type="button" className="btn-primary btn-sm" disabled={saving || !members || blockedBySplit || doneValues.length === 0} onClick={apply}>
              {saving ? <LoadingDots /> : `Converter ${mappedCells.toLocaleString("pt-BR")} células`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
