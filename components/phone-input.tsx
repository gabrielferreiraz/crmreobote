"use client";

import { useLayoutEffect, useRef } from "react";
import { formatPhoneMask } from "@/lib/phone-normalize";

/**
 * Campo de telefone/WhatsApp com máscara "ao vivo" (ver formatPhoneMask em
 * lib/phone-normalize.ts) — extraído pra um componente só porque os
 * formulários de Clientes (criar e editar) precisavam do mesmo campo
 * duas vezes cada (Celular e WhatsApp), e duplicar a lógica de cursor
 * abaixo em 4 lugares é exatamente o tipo de coisa que sai de sincronia
 * sem ninguém perceber depois.
 *
 * Cursor preservado manualmente: todo <input> controlado cujo `value` é
 * reescrito por fora (aqui, a máscara reformatando a cada tecla) joga o
 * cursor pro FIM sozinho a cada re-render — sem esse ajuste, dava pra
 * digitar um número novo mas não corrigir um dígito no MEIO dele (o cursor
 * fugia pro final assim que a máscara mexia no texto). A técnica: conta
 * quantos DÍGITOS existem antes do cursor no valor cru digitado (não a
 * posição em caracteres, que muda conforme parênteses/traço entram e
 * saem), reformata, e acha onde esse mesmo dígito parou no texto novo.
 */
export function PhoneInput({
  label,
  value,
  onChange,
  error,
  required,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  required?: boolean;
  autoFocus?: boolean;
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

    const masked = formatPhoneMask(raw);

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
      <label className="field-label">
        {label}
        {required && " *"}
      </label>
      <input
        ref={inputRef}
        type="tel"
        inputMode="tel"
        autoFocus={autoFocus}
        value={value}
        onChange={handleChange}
        className="field-input"
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
