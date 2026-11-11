"use client";

import { useLayoutEffect, useRef } from "react";
import { applyPhoneMask, formatPhoneMask, limitPhoneInput } from "@/lib/phone-normalize";

/**
 * Campo de telefone/WhatsApp com máscara "ao vivo" (ver formatPhoneMask em
 * lib/phone-normalize.ts) — o número brasileiro aparece sempre com o DDI:
 * "+55 (67) 99999-9999". Extraído pra um componente só porque os
 * formulários de Clientes (criar e editar) precisavam do mesmo campo
 * duas vezes cada (Celular e WhatsApp), e duplicar a lógica de cursor
 * abaixo em 4 lugares é exatamente o tipo de coisa que sai de sincronia
 * sem ninguém perceber depois.
 *
 * Cursor preservado manualmente: todo <input> controlado cujo `value` é
 * reescrito por fora (aqui, a máscara reformatando a cada tecla) joga o
 * cursor pro FIM sozinho a cada re-render — sem esse ajuste, dava pra
 * digitar um número novo mas não corrigir um dígito no MEIO dele (o cursor
 * fugia pro final assim que a máscara mexia no texto). A conta do cursor
 * (dígitos DEPOIS dele, não antes — a máscara acrescenta o "+55 " na frente)
 * vive em applyPhoneMask, função pura e testada.
 */
export function PhoneInput({
  label,
  value,
  onChange,
  error,
  required,
  autoFocus,
  inputClassName,
  hideLabel = false,
  containerClassName,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  required?: boolean;
  autoFocus?: boolean;
  inputClassName?: string;
  hideLabel?: boolean;
  containerClassName?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const nextCaretRef = useRef<number | null>(null);
  const maskedValue = formatPhoneMask(value);

  // Brasileiro completo ocupa 19 caracteres com a mascara. Para numeros
  // internacionais, o limite E.164 e de 15 digitos mais o sinal de "+".
  const maxLength = maskedValue.startsWith("+55") || !maskedValue ? 19 : maskedValue.startsWith("+") ? 16 : 15;

  useLayoutEffect(() => {
    if (nextCaretRef.current === null || !inputRef.current) return;
    inputRef.current.setSelectionRange(nextCaretRef.current, nextCaretRef.current);
    nextCaretRef.current = null;
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = limitPhoneInput(e.target.value);
    const caret = Math.min(e.target.selectionStart ?? raw.length, raw.length);
    const { value: masked, caret: caretInMasked } = applyPhoneMask(raw, caret);

    nextCaretRef.current = caretInMasked;
    onChange(masked);
  }

  return (
    <div className={`space-y-1 ${containerClassName ?? ""}`}>
      {!hideLabel && <label className="field-label">
        {label}
        {required && " *"}
      </label>}
      <input
        ref={inputRef}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        autoFocus={autoFocus}
        value={maskedValue}
        onChange={handleChange}
        maxLength={maxLength}
        placeholder="+55 (00) 00000-0000"
        aria-invalid={!!error}
        className={`field-input ${inputClassName ?? ""}`}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
