"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BadgeDollarSign, CalendarRange, RotateCcw } from "lucide-react";
import type { ExecutiveReportData } from "@/lib/reports/executive-data";
import { EXECUTIVE_MONTHS_LONG } from "@/lib/reports/executive-utils";

export function ExecutivePeriodFilter({
  range,
  throughMonth,
  exactValues,
}: {
  range: ExecutiveReportData["range"];
  throughMonth: number;
  exactValues: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const firstAvailableYear = range.availableYears[0] ?? range.endYear;
  const currentReportYear = range.availableYears.at(-1) ?? range.endYear;
  const isDefault = range.startYear === firstAvailableYear
    && range.endYear === currentReportYear
    && throughMonth === range.latestClosedMonth;

  const navigate = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  const changeStartYear = (year: number) => {
    navigate((params) => {
      params.set("execFromYear", String(year));
      if (year > range.endYear) params.set("execToYear", String(year));
    });
  };

  const changeEndYear = (year: number) => {
    navigate((params) => {
      params.set("execToYear", String(year));
      if (year < range.startYear) params.set("execFromYear", String(year));
      const maximumMonth = year === currentReportYear ? range.latestClosedMonth : 11;
      if (throughMonth > maximumMonth) params.set("execMonth", String(maximumMonth + 1));
    });
  };

  const reset = () => {
    navigate((params) => {
      params.delete("execFromYear");
      params.delete("execToYear");
      params.delete("execMonth");
    });
  };

  const toggleExactValues = () => {
    navigate((params) => {
      if (exactValues) params.delete("execExact");
      else params.set("execExact", "1");
    });
  };

  return (
    <section
      className={`border-b border-neutral-200 bg-neutral-50/70 px-4 py-4 transition-opacity dark:border-neutral-800 dark:bg-neutral-900/40 lg:mt-5 lg:rounded-lg lg:border lg:px-5 ${isPending ? "opacity-60" : ""}`}
      aria-label="Período de comparação"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-violet-100 text-violet-700 dark:bg-violet-950/70 dark:text-violet-300">
            <CalendarRange className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-neutral-950 dark:text-white">Comparação histórica</h2>
            <p className="truncate text-sm text-neutral-500 dark:text-neutral-400">
              {range.startYear}–{range.endYear}, janeiro a {EXECUTIVE_MONTHS_LONG[throughMonth].toLocaleLowerCase("pt-BR")}
            </p>
          </div>
        </div>
        {!isDefault && (
          <button
            type="button"
            onClick={reset}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-[color,background-color,transform] hover:bg-neutral-200/70 hover:text-neutral-900 active:scale-95 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            aria-label="Usar todo o histórico disponível"
            title="Usar todo o histórico"
          >
            <RotateCcw className="h-4.5 w-4.5" strokeWidth={2} />
          </button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:flex lg:items-end">
        <FilterSelect
          label="Primeiro ano"
          value={range.startYear}
          onChange={changeStartYear}
          options={range.availableYears.filter((year) => year <= range.endYear)}
        />
        <FilterSelect
          label="Último ano"
          value={range.endYear}
          onChange={changeEndYear}
          options={range.availableYears.filter((year) => year >= range.startYear)}
        />
        <label className="col-span-2 block lg:min-w-56">
          <span className="mb-1.5 block text-sm font-medium text-neutral-600 dark:text-neutral-300">Comparar todos até</span>
          <select
            value={throughMonth}
            onChange={(event) => navigate((params) => params.set("execMonth", String(Number(event.target.value) + 1)))}
            className="field-input min-h-11 text-base"
          >
            {EXECUTIVE_MONTHS_LONG.slice(0, range.maxThroughMonth + 1).map((month, index) => (
              <option key={month} value={index}>{month}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={exactValues}
          onClick={toggleExactValues}
          className={`col-span-2 flex min-h-11 items-center gap-3 rounded-md border px-3 text-left transition-[border-color,background-color,color,transform] active:scale-[0.99] lg:ml-auto lg:min-w-64 ${
            exactValues
              ? "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200"
              : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200 dark:hover:border-neutral-600"
          }`}
        >
          <BadgeDollarSign className="h-5 w-5 shrink-0" strokeWidth={2} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Valores exatos</span>
            <span className="block text-xs text-neutral-500 dark:text-neutral-400">Mostrar reais e centavos</span>
          </span>
          <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${exactValues ? "bg-violet-600" : "bg-neutral-300 dark:bg-neutral-700"}`} aria-hidden="true">
            <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${exactValues ? "translate-x-6" : "translate-x-1"}`} />
          </span>
        </button>
      </div>
    </section>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: number[];
  onChange: (value: number) => void;
}) {
  return (
    <label className="block lg:min-w-40">
      <span className="mb-1.5 block text-sm font-medium text-neutral-600 dark:text-neutral-300">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="field-input min-h-11 text-base"
      >
        {options.map((year) => <option key={year} value={year}>{year}</option>)}
      </select>
    </label>
  );
}
