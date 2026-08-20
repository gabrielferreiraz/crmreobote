"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { DatePicker } from "@/components/date-picker";

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

type BusinessHours = { start: string; end: string; days: number[]; holidays: string[] };

export function BusinessHoursForm({ initial }: { initial: BusinessHours | null }) {
  const router = useRouter();
  const [start, setStart] = useState(initial?.start ?? "08:00");
  const [end, setEnd] = useState(initial?.end ?? "18:00");
  const [days, setDays] = useState<number[]>(initial?.days ?? [1, 2, 3, 4, 5]);
  const [holidays, setHolidays] = useState<string[]>(initial?.holidays ?? []);
  const [newHoliday, setNewHoliday] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggleDay(day: number) {
    setSaved(false);
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }

  function addHoliday() {
    if (!newHoliday || holidays.includes(newHoliday)) return;
    setSaved(false);
    setHolidays((prev) => [...prev, newHoliday].sort());
    setNewHoliday("");
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    const res = await fetch("/api/organization/business-hours", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start, end, days, holidays }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao salvar horário de atendimento");
      return;
    }

    setSaved(true);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="card space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="field-label">Início</label>
            <input
              type="time"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                setSaved(false);
              }}
              className="field-input"
            />
          </div>
          <div className="space-y-1">
            <label className="field-label">Término</label>
            <input
              type="time"
              value={end}
              onChange={(e) => {
                setEnd(e.target.value);
                setSaved(false);
              }}
              className="field-input"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="field-label">Dias da semana</label>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_LABELS.map((label, i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggleDay(i)}
                className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  days.includes(i)
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                    : "border-neutral-200 text-neutral-500 hover:border-neutral-300 dark:border-neutral-700 dark:text-neutral-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="field-label">Feriados (contam como fora do expediente, independente do dia/hora)</label>
          <div className="flex flex-wrap gap-1.5">
            {holidays.map((h) => (
              <span
                key={h}
                className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
              >
                {h.split("-").reverse().join("/")}
                <button
                  type="button"
                  onClick={() => {
                    setSaved(false);
                    setHolidays((prev) => prev.filter((d) => d !== h));
                  }}
                  className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                >
                  <X className="h-3 w-3" strokeWidth={2.5} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <DatePicker value={newHoliday} onChange={setNewHoliday} className="flex-1" />
            <button type="button" onClick={addHoliday} disabled={!newHoliday} className="btn-ghost btn-sm">
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
              Adicionar
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={handleSave} disabled={saving || days.length === 0} className="btn-primary">
          {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
          Salvar
        </button>
        {saved && <span className="text-sm text-neutral-500 dark:text-neutral-400">Salvo.</span>}
      </div>
    </div>
  );
}
