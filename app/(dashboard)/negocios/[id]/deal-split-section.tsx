"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Minus, Plus, Users, X } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Select } from "@/components/select";
import { requestJson } from "@/lib/client-request";
import { equalSplit, MAX_CO_OWNERS } from "@/lib/deals/split-shares";

export type DealSplitShare = { userId: string; name: string; photoUrl: string | null; percent: number; isPrincipal: boolean };

export type DealSplitData = {
  /** Só o responsável principal mexe na divisão. */
  canEdit: boolean;
  /** Principal primeiro, depois os co-responsáveis. */
  shares: DealSplitShare[];
};

type Row = { userId: string; name: string; photoUrl: string | null; percent: number };

/** Uma cor por pessoa (a mesma na barra e na faixa da linha). Classes escritas por extenso pro Tailwind enxergar. */
const COLORS = ["bg-brand", "bg-emerald-500", "bg-amber-500", "bg-violet-500", "bg-sky-500", "bg-rose-500"];

/** Atalhos pra quando só há um co-responsável: principal/co-responsável. */
const PRESETS = [50, 40, 30, 20];

const STEP = 5;

const noSpinner =
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

/**
 * Divisão do negócio entre responsáveis (ver lib/deals/split.ts). Barra
 * colorida com a parte de cada um, e abaixo a lista. O responsável principal
 * edita: adiciona alguém (a divisão vira igual entre todos, 2 pessoas =
 * 50/50), ajusta o % de cada co-responsável com − e + (ou digitando) ou por um
 * atalho, e tira quem quiser. A parte do principal é sempre o que sobra. Quem
 * não é o principal só vê. Sem ninguém dividindo e sem poder editar, não
 * aparece nada.
 */
export function DealSplitSection({
  dealId,
  members,
  split,
}: {
  dealId: string;
  members: { id: string; name: string }[];
  split: DealSplitData;
}) {
  const router = useRouter();
  const principal = split.shares[0];
  const saved: Row[] = split.shares.filter((s) => !s.isPrincipal).map((s) => ({ userId: s.userId, name: s.name, photoUrl: s.photoUrl, percent: s.percent }));
  const [rows, setRows] = useState<Row[]>(saved);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const valid = (n: number) => (Number.isFinite(n) ? n : 0);
  const coTotal = rows.reduce((sum, r) => sum + valid(r.percent), 0);
  const principalPercent = 100 - coTotal;
  const invalid = rows.some((r) => !Number.isInteger(r.percent) || r.percent < 1 || r.percent > 99) || principalPercent < 1;
  const dirty = JSON.stringify(rows.map((r) => [r.userId, r.percent])) !== JSON.stringify(saved.map((r) => [r.userId, r.percent]));

  if (!split.canEdit && saved.length === 0) return null;

  const candidates = members.filter((m) => m.id !== principal.userId && !rows.some((r) => r.userId === m.id));
  const open = rows.length > 0 || adding;

  /** Maior % que esta pessoa pode ter sem deixar o principal abaixo de 1%. */
  const maxFor = (userId: string) => 99 - (coTotal - valid(rows.find((r) => r.userId === userId)?.percent ?? 0));
  const update = (userId: string, percent: number) => setRows(rows.map((r) => (r.userId === userId ? { ...r, percent } : r)));
  const clamp = (userId: string, value: number) => Math.min(maxFor(userId), Math.max(1, Math.round(value)));

  function addPerson(userId: string) {
    const member = members.find((m) => m.id === userId);
    if (!member) return;
    // Entrou mais um: a divisão vira igual entre todo mundo (o principal fica com o resto).
    const { coOwner } = equalSplit(rows.length + 2);
    setRows([...rows.map((r) => ({ ...r, percent: coOwner })), { userId, name: member.name, photoUrl: null, percent: coOwner }]);
    setAdding(false);
  }

  async function save() {
    setSaving(true);
    const res = await requestJson(`/api/deals/${dealId}/participants`, {
      method: "PUT",
      json: { participants: rows.map((r) => ({ userId: r.userId, sharePercent: r.percent })) },
    });
    setSaving(false);
    if (res.ok) router.refresh();
  }

  // Ninguém dividindo ainda: só um convite, sem lista nem barra.
  if (!open) {
    return (
      <div className="border-t border-neutral-100 pt-3 dark:border-neutral-800">
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 px-3 py-2.5 text-sm font-medium text-neutral-600 transition-colors hover:border-brand hover:bg-brand-light hover:text-brand dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-brand dark:hover:bg-[var(--brand-subtle)] dark:hover:text-brand"
        >
          <Users className="h-4 w-4" strokeWidth={2} />
          Dividir negócio
        </button>
      </div>
    );
  }

  const people: { userId: string; name: string; photoUrl: string | null; percent: number; isPrincipal: boolean }[] = [
    { userId: principal.userId, name: principal.name, photoUrl: principal.photoUrl, percent: principalPercent, isPrincipal: true },
    ...rows.map((r) => ({ ...r, isPrincipal: false })),
  ];

  return (
    <div className="space-y-3 border-t border-neutral-100 pt-3 dark:border-neutral-800">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium text-neutral-800 dark:text-neutral-200">
          <Users className="h-4 w-4 text-brand" strokeWidth={2} />
          Divisão
        </span>
        <span className="text-xs text-neutral-400 dark:text-neutral-500">{people.length} {people.length === 1 ? "pessoa" : "pessoas"}</span>
      </div>

      {/* Barra: quanto cada um leva. */}
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800" role="img" aria-label="Parte de cada pessoa">
        {people.map((p, i) => (
          <span
            key={p.userId}
            className={`h-full transition-[width] duration-300 ${p.isPrincipal && principalPercent < 1 ? "bg-red-500" : COLORS[i % COLORS.length]}`}
            style={{ width: `${Math.max(0, valid(p.percent))}%` }}
          />
        ))}
      </div>

      <ul className="space-y-2">
        {people.map((p, i) => (
          <li key={p.userId} className="flex items-center gap-2.5">
            <span className={`h-9 w-1 shrink-0 rounded-full ${COLORS[i % COLORS.length]}`} aria-hidden="true" />
            <Avatar name={p.name} src={p.photoUrl} size="sm" />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{p.name}</span>
              <span className="block text-[11px] text-neutral-400 dark:text-neutral-500">{p.isPrincipal ? "Principal" : "Co-responsável"}</span>
            </span>

            {p.isPrincipal || !split.canEdit ? (
              <span className={`text-sm font-semibold tabular-nums ${p.isPrincipal && principalPercent < 1 ? "text-red-600" : "text-neutral-900 dark:text-neutral-100"}`}>
                {valid(p.percent)}%
              </span>
            ) : (
              <>
                <span className="inline-flex items-center rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
                  <button
                    type="button"
                    onClick={() => update(p.userId, clamp(p.userId, valid(p.percent) - STEP))}
                    disabled={valid(p.percent) <= 1}
                    aria-label={`Diminuir a parte de ${p.name}`}
                    className="flex h-7 w-7 items-center justify-center rounded-l-lg text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
                  >
                    <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={99}
                    value={Number.isNaN(p.percent) ? "" : p.percent}
                    onChange={(e) => update(p.userId, e.target.value === "" ? Number.NaN : clamp(p.userId, Number(e.target.value)))}
                    onBlur={() => Number.isNaN(p.percent) && update(p.userId, Math.min(50, maxFor(p.userId)))}
                    aria-label={`Parte de ${p.name}`}
                    className={`h-7 w-9 bg-transparent text-center text-sm font-semibold tabular-nums text-neutral-900 outline-none dark:text-neutral-100 ${noSpinner}`}
                  />
                  <span className="pr-0.5 text-xs text-neutral-400">%</span>
                  <button
                    type="button"
                    onClick={() => update(p.userId, clamp(p.userId, valid(p.percent) + STEP))}
                    disabled={valid(p.percent) >= maxFor(p.userId)}
                    aria-label={`Aumentar a parte de ${p.name}`}
                    className="flex h-7 w-7 items-center justify-center rounded-r-lg text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </button>
                </span>
                <button
                  type="button"
                  onClick={() => setRows(rows.filter((x) => x.userId !== p.userId))}
                  aria-label={`Tirar ${p.name}`}
                  className="icon-btn h-7 w-7 shrink-0"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      {/* Atalhos de divisão. */}
      {split.canEdit && !adding && rows.length === 1 && (
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((co) => {
            const active = rows[0].percent === co;
            return (
              <button
                key={co}
                type="button"
                onClick={() => update(rows[0].userId, co)}
                aria-pressed={active}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums transition-colors ${
                  active
                    ? "border-brand bg-brand-light text-brand dark:bg-[var(--brand-subtle)]"
                    : "border-neutral-200 text-neutral-600 hover:border-neutral-300 dark:border-neutral-700 dark:text-neutral-300"
                }`}
              >
                {100 - co}/{co}
              </button>
            );
          })}
        </div>
      )}
      {split.canEdit && !adding && rows.length > 1 && (
        <button
          type="button"
          onClick={() => {
            const { coOwner } = equalSplit(rows.length + 1);
            setRows(rows.map((r) => ({ ...r, percent: coOwner })));
          }}
          className="rounded-full border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-600 transition-colors hover:border-neutral-300 dark:border-neutral-700 dark:text-neutral-300"
        >
          Dividir igual
        </button>
      )}

      {/* Escolher quem entra. */}
      {split.canEdit && adding && (
        <div className="space-y-2 rounded-xl border border-neutral-200 bg-neutral-50/70 p-2.5 dark:border-neutral-700 dark:bg-neutral-800/40">
          <Select value="" onChange={addPerson} placeholder="Escolher consultor" className="py-1.5 text-sm" options={candidates.map((m) => ({ value: m.id, label: m.name }))} />
          <button type="button" onClick={() => setAdding(false)} className="text-xs text-neutral-500 hover:underline dark:text-neutral-400">
            Cancelar
          </button>
        </div>
      )}
      {split.canEdit && !adding && rows.length < MAX_CO_OWNERS && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-500 transition-colors hover:border-brand hover:text-brand dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-brand dark:hover:text-brand"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          Adicionar pessoa
        </button>
      )}

      {split.canEdit && dirty && (
        <div className="space-y-2 pt-1">
          {invalid && <p className="text-xs text-red-600 dark:text-red-400">Ajuste os %: o principal fica com pelo menos 1%.</p>}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => { setRows(saved); setAdding(false); }} disabled={saving} className="btn-ghost btn-sm">
              Cancelar
            </button>
            <button type="button" onClick={save} disabled={saving || invalid} className="btn-primary btn-sm">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />}
              Salvar divisão
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
