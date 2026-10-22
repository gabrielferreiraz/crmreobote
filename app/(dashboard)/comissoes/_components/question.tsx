"use client";

import { Check } from "lucide-react";

/**
 * Formulário de configuração em forma de PERGUNTA ("Em quantas vezes ela
 * paga a comissão?"), com as respostas em botões grandes lado a lado — quem
 * configura enxerga todas as opções de uma vez, sem abrir lista nem decifrar
 * sigla.
 */
export function Question({
  title,
  children,
  required = false,
}: {
  title: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 w-full text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        <span className="flex items-center justify-between gap-3">
          <span>{title}</span>
          {required && <span className="text-xs font-medium text-brand">Obrigatório</span>}
        </span>
      </legend>
      {children}
    </fieldset>
  );
}

export function Choices<T extends string>({
  value,
  onChange,
  options,
  columns = 2,
  mobileColumns,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  columns?: 2 | 3 | 4;
  mobileColumns?: 1 | 2 | 3 | 4;
}) {
  const mobileGrid = {
    1: "grid-cols-1",
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-4",
  }[mobileColumns ?? (columns === 3 ? 1 : 2)];
  const desktopGrid = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" }[columns];
  return (
    <div role="radiogroup" className={`grid gap-2 ${mobileGrid} ${desktopGrid}`}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`relative min-h-11 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
              active
                ? "border-brand bg-brand-light pr-8 text-brand ring-1 ring-brand"
                : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            {option.label}
            {active && <Check className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" strokeWidth={2.5} aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}
