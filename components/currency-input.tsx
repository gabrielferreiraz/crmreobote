"use client";

export function CurrencyInput({
  value,
  onChange,
  className = "",
  style,
  bare,
  prefixClassName,
  autoFocus,
  onBlur,
  onKeyDown,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** Pra tamanho de fonte/peso maiores que o padrão sem o `bare` abaixo
   * (`.field-input` fixa `font-size` na própria regra, e no CSS compilado
   * ela vem DEPOIS das utilitárias de texto/fonte do Tailwind — passar
   * `text-2xl` em `className` seria ignorado em silêncio nesse caso).
   * `style` inline sempre vence, não importa a ordem no CSS gerado. */
  style?: React.CSSProperties;
  /** Sem a caixa de campo de formulário (sem borda/fundo/sombra de
   * `.field-input`) — pra editar um número no próprio lugar dele, no mesmo
   * tamanho do texto de exibição (ex.: goal-card.tsx), em vez de um campo
   * de input comum plantado ali no meio. `className` do chamador decide o
   * visual inteiro (tamanho, cor, o contorno de "editando" — mesmo
   * `ring-2 ring-brand/30` que o editor da proposta já usa). Em modo
   * `bare`, SEMPRE passe `prefixClassName` junto (ver abaixo) — o padding à
   * esquerda do número precisa abrir espaço pro "R$" no tamanho escolhido,
   * senão um fica em cima do outro (aconteceu: "R$" de um tamanho, padding
   * calculado pra outro). */
  bare?: boolean;
  /** Tamanho do "R$" em modo `bare` — precisa ser escolhido JUNTO do
   * `paddingLeft` em `style` (ou de um `pl-*` em `className`, fora do
   * `bare`): é o chamador que sabe o tamanho do número ao lado, não este
   * componente. Sem `bare`, o "R$" sempre usa o tamanho padrão pequeno
   * (`text-sm`), ignorado. */
  prefixClassName?: string;
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
      <span
        className={`pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-medium text-neutral-400 dark:text-neutral-500 ${
          bare ? (prefixClassName ?? "") : "text-sm"
        }`}
      >
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
        className={`${bare ? "w-full bg-transparent outline-none" : "field-input"} pl-9 ${className}`}
        style={style}
      />
    </div>
  );
}
