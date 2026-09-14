"use client";

import { useLayoutEffect, useRef } from "react";
import { formatBirthDateMask } from "@/lib/birth-date";

/**
 * Campo de data de nascimento com máscara "ao vivo" DD/MM/AAAA — pedido
 * explícito pra substituir o <input type="date"> nativo (calendário do
 * navegador é ruim pra chegar num ano antigo: exige clicar "mês anterior"
 * dezenas de vezes, a menos que já se saiba clicar no rótulo do ano pra
 * pular direto). Digitar 8 dígitos seguidos (ex.: "14051987") já formata
 * sozinho, sem abrir calendário nenhum — ver formatBirthDateMask em
 * lib/birth-date.ts.
 *
 * Cursor preservado manualmente — mesma técnica (e mesmo raciocínio, ver o
 * comentário lá) de components/phone-input.tsx: todo <input> controlado
 * cujo `value` é reescrito por fora (a máscara reformatando a cada tecla)
 * joga o cursor pro FIM sozinho a cada re-render, o que impediria corrigir
 * um dígito no MEIO da data já digitada.
 */
export function BirthDateInput({
  label = "Data de nascimento",
  value,
  onChange,
  error,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const nextCaretRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (nextCaretRef.current === null || !inputRef.current) return;
    inputRef.current.setSelectionRange(nextCaretRef.current, nextCaretRef.current);
    nextCaretRef.current = null;
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const caret = e.target.selectionStart ?? raw.length;
    const digitsBeforeCaret = raw.slice(0, caret).replace(/\D/g, "").length;

    const masked = formatBirthDateMask(raw);

    let caretInMasked = masked.length;
    if (digitsBeforeCaret === 0) {
      caretInMasked = 0;
    } else {
      let seen = 0;
      for (let i = 0; i < masked.length; i++) {
        if (/\d/.test(masked[i])) seen++;
        if (seen === digitsBeforeCaret) {
          caretInMasked = i + 1;
          break;
        }
      }
    }

    nextCaretRef.current = caretInMasked;
    onChange(masked);
  }

  return (
    <div className="space-y-1">
      <label className="field-label">{label}</label>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        // NUNCA "bday" — esse token de autocomplete é pro aniversário de
        // quem está preenchendo o formulário (dono do navegador), não do
        // cliente sendo cadastrado; um autofill "certo" nesse sentido ainda
        // seria o dado ERRADO aqui. "off" também evita o navegador tentar
        // adivinhar/reordenar dígitos num formato que não bate com a
        // máscara DD/MM/AAAA (ex.: autofill em YYYY-MM-DD entraria como
        // dígitos fora de ordem).
        autoComplete="off"
        placeholder="DD/MM/AAAA"
        value={value}
        onChange={handleChange}
        maxLength={10}
        className="field-input"
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
