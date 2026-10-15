"use client";

/**
 * Campo de número inteiro pequeno (dia do mês, quantidade de parcelas).
 *
 * Guarda o TEXTO digitado, não um número já corrigido: corrigir a cada
 * tecla (vazio → 1, 0 → 1) deixava o campo impossível de apagar — a pessoa
 * apagava o "1" e ele voltava na hora, e não dava pra digitar "25" por cima.
 * Quem usa valida o valor final (e mostra a frase do que falta) em vez de
 * trocar o número escondido.
 *
 * Sem as setinhas do <input type="number">: são pequenas demais, mudam o
 * valor com a rolagem do mouse sem a pessoa perceber, e não ajudam quem só
 * quer digitar. Ao clicar, o número inteiro fica selecionado — é só digitar
 * o novo por cima.
 */
export function WholeNumberInput({
  value,
  onChange,
  maxLength = 2,
  invalid = false,
  ariaLabel,
  className = "w-20",
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  invalid?: boolean;
  ariaLabel: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={maxLength}
      className={`field-input text-center text-base font-semibold tabular-nums ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      onFocus={(e) => e.target.select()}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      autoFocus={autoFocus}
    />
  );
}

/** Lê o texto do campo: número inteiro dentro do limite, ou null (vazio/fora do limite). */
export function parseWholeNumber(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}
