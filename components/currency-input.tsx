"use client";

export function CurrencyInput({
  value,
  onChange,
  className = "",
  autoFocus,
  onBlur,
  onKeyDown,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  autoFocus?: boolean;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const cents = value ? Math.round(Number(value) * 100) : 0;
  const display = cents
    ? (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "";

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, "");
    onChange(digits ? (Number(digits) / 100).toFixed(2) : "");
  }

  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-neutral-400 dark:text-neutral-500 font-medium">
        R$
      </span>
      <input
        autoFocus={autoFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        inputMode="decimal"
        value={display}
        onChange={handleChange}
        placeholder="0,00"
        className={`field-input pl-9 ${className}`}
      />
    </div>
  );
}
