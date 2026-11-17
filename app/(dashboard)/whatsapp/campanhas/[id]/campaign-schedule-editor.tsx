"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock3, Loader2, Pencil } from "lucide-react";

const WEEKDAYS = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
] as const;

/**
 * Horário de envio da campanha (dias + faixa de horas, em Brasília). Aparece
 * na página de detalhe e pode ser trocado com a campanha rodando ou pausada —
 * até aqui só dava para mudar em rascunho, no modal de edição da lista.
 */
export function CampaignScheduleEditor({
  id,
  allowedWeekdays,
  windowStartHour,
  windowEndHour,
  editable,
}: {
  id: string;
  allowedWeekdays: number[];
  windowStartHour: number;
  windowEndHour: number;
  /** Só quem gerencia a campanha, e só enquanto ela não concluiu. */
  editable: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [days, setDays] = useState(allowedWeekdays);
  const [start, setStart] = useState(String(windowStartHour));
  const [end, setEnd] = useState(String(windowEndHour));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const summary = `Das ${windowStartHour}h às ${windowEndHour}h · ${allowedWeekdays.map((d) => WEEKDAYS[d]?.label).join(", ")}`;

  function open() {
    setDays(allowedWeekdays);
    setStart(String(windowStartHour));
    setEnd(String(windowEndHour));
    setError(null);
    setEditing(true);
  }

  async function save() {
    const s = Number(start);
    const e = Number(end);
    if (days.length === 0) return setError("Escolha ao menos um dia da semana.");
    if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || s > 23 || e < 0 || e > 23) return setError("O horário precisa estar entre 0h e 23h.");
    if (e <= s) return setError("O horário final precisa ser depois do inicial.");

    setSaving(true);
    setError(null);
    const res = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowedWeekdays: days, windowStartHour: s, windowEndHour: e }),
    }).catch(() => null);
    setSaving(false);
    if (!res) return setError("Sem conexão. Tente de novo.");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return setError((data as { error?: string }).error ?? "Não foi possível salvar o horário.");
    }
    setEditing(false);
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950" aria-label="Horário de envio">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Clock3 className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={2} />
          <span className="font-medium text-neutral-900 dark:text-neutral-100">Horário de envio</span>
          {!editing && <span className="text-neutral-600 dark:text-neutral-300">{summary}</span>}
        </div>
        {editable && !editing && (
          <button type="button" onClick={open} className="btn-ghost">
            <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
            Editar
          </button>
        )}
      </div>

      {editing && (
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
            <span>Das</span>
            <input type="number" min={0} max={23} value={start} onChange={(e) => setStart(e.target.value)} className="field-input w-20 px-2 py-1 text-center" aria-label="Hora inicial" />
            <span>às</span>
            <input type="number" min={0} max={23} value={end} onChange={(e) => setEnd(e.target.value)} className="field-input w-20 px-2 py-1 text-center" aria-label="Hora final" />
            <span>h (horário de Brasília)</span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((day) => {
              const selected = days.includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setDays(selected ? days.filter((d) => d !== day.value) : [...days, day.value].sort((a, b) => a - b))}
                  className={`min-w-12 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors ${
                    selected
                      ? "border-brand bg-brand text-white"
                      : "border-neutral-300 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-600"
                  }`}
                >
                  {day.label}
                </button>
              );
            })}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={saving} className="btn-primary">
              {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
              Salvar horário
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="btn-ghost">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
