"use client";

import { DualRangeSlider } from "@/components/dual-range-slider";

const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 33;
const WEEKDAYS = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sab" },
] as const;

export type BulkCampaignSchedule = {
  delayMinSec: number;
  delayMaxSec: number;
  dailyCap: string;
  allowedWeekdays: number[];
  windowStartHour: string;
  windowEndHour: string;
};

function roundedMinutes(seconds: number): number {
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(seconds / 60)));
}

/** Configuração de agenda/ritmo compartilhada pelos envios em massa de Clientes e Pipeline. */
export function BulkCampaignScheduleFields({
  value,
  onChange,
}: {
  value: BulkCampaignSchedule;
  onChange: (value: BulkCampaignSchedule) => void;
}) {
  function update(patch: Partial<BulkCampaignSchedule>) {
    onChange({ ...value, ...patch });
  }

  function toggleWeekday(day: number) {
    update({
      allowedWeekdays: value.allowedWeekdays.includes(day)
        ? value.allowedWeekdays.filter((current) => current !== day)
        : [...value.allowedWeekdays, day].sort((a, b) => a - b),
    });
  }

  return (
    <section className="space-y-4 border-t border-neutral-100 pt-5 dark:border-neutral-800">
      <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Ritmo de envio</h3>

      <div className="space-y-2">
        <label className="field-label">Intervalo entre envios</label>
        <DualRangeSlider
          min={MIN_INTERVAL_MINUTES}
          max={MAX_INTERVAL_MINUTES}
          value={[roundedMinutes(value.delayMinSec), roundedMinutes(value.delayMaxSec)]}
          onChange={([delayMinMinutes, delayMaxMinutes]) => update({ delayMinSec: delayMinMinutes * 60, delayMaxSec: delayMaxMinutes * 60 })}
        />
        <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
          <span>De</span>
          <input
            type="number"
            min={MIN_INTERVAL_MINUTES}
            max={MAX_INTERVAL_MINUTES}
            value={roundedMinutes(value.delayMinSec)}
            onInput={(event) => {
              event.currentTarget.value = event.currentTarget.value.replace(/^0+(?=\d)/, "");
            }}
            onChange={(event) => update({ delayMinSec: Number(event.target.value) * 60 })}
            className="field-input w-20 px-2 py-1 text-center"
          />
          <span>a</span>
          <input
            type="number"
            min={MIN_INTERVAL_MINUTES}
            max={MAX_INTERVAL_MINUTES}
            value={roundedMinutes(value.delayMaxSec)}
            onInput={(event) => {
              event.currentTarget.value = event.currentTarget.value.replace(/^0+(?=\d)/, "");
            }}
            onChange={(event) => update({ delayMaxSec: Number(event.target.value) * 60 })}
            className="field-input w-20 px-2 py-1 text-center"
          />
          <span>minutos</span>
        </div>
      </div>

      <div className="space-y-2">
        <label className="field-label">Horário de envio</label>
        <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
          <span>Das</span>
          <input
            type="number"
            min={0}
            max={23}
            value={value.windowStartHour}
            onInput={(event) => {
              event.currentTarget.value = event.currentTarget.value.replace(/^0+(?=\d)/, "");
            }}
            onChange={(event) => update({ windowStartHour: event.target.value })}
            className="field-input w-20 px-2 py-1 text-center"
          />
          <span>às</span>
          <input
            type="number"
            min={0}
            max={23}
            value={value.windowEndHour}
            onInput={(event) => {
              event.currentTarget.value = event.currentTarget.value.replace(/^0+(?=\d)/, "");
            }}
            onChange={(event) => update({ windowEndHour: event.target.value })}
            className="field-input w-20 px-2 py-1 text-center"
          />
          <span>h</span>
        </div>
      </div>

      <div className="space-y-2">
        <span className="field-label">Quais dias enviar?</span>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((day) => {
            const selected = value.allowedWeekdays.includes(day.value);
            return (
              <button
                key={day.value}
                type="button"
                onClick={() => toggleWeekday(day.value)}
                aria-pressed={selected}
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
      </div>

      <div className="space-y-2">
        <label className="field-label" htmlFor="bulk-daily-cap">Quantos contatos por dia</label>
        <input
          id="bulk-daily-cap"
          type="number"
          min={1}
          max={10000}
          value={value.dailyCap}
          placeholder="Sem limite"
          onInput={(event) => {
            event.currentTarget.value = event.currentTarget.value.replace(/^0+(?=\d)/, "");
          }}
          onChange={(event) => update({ dailyCap: event.target.value })}
          className="field-input w-44 px-3 py-1.5"
        />
      </div>
    </section>
  );
}
