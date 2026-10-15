"use client";

/**
 * Formulário de configuração em forma de PERGUNTA ("Em quantas vezes ela
 * paga a comissão?"), com as respostas em botões grandes lado a lado — quem
 * configura enxerga todas as opções de uma vez, sem abrir lista nem decifrar
 * sigla.
 */
export function Question({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</legend>
      {children}
    </fieldset>
  );
}

export function Choices<T extends string>({
  value,
  onChange,
  options,
  columns = 2,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  columns?: 2 | 3 | 4;
}) {
  const grid = { 2: "grid-cols-2", 3: "grid-cols-1 sm:grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" }[columns];
  return (
    <div role="radiogroup" className={`grid gap-2 ${grid}`}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
              active
                ? "border-brand bg-brand-light text-brand ring-1 ring-brand"
                : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
