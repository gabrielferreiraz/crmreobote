import { FieldError } from "@/components/field-error";

/**
 * Campo de texto rotulado, com suporte a erro de validação por campo
 * (aria-invalid + mensagem ligada por aria-describedby). Extraído de cópias
 * idênticas em clientes/contacts-table.tsx e components/edit-contact-dialog.tsx
 * (achado M3 do relatório de QA pedia feedback por campo nos dois).
 *
 * `id` é opcional, mas sem ele não há como o foco ir até o campo quando ele é
 * o primeiro inválido (ver focusField em components/field-error.tsx) nem como
 * ligar a mensagem de erro ao input.
 */
export function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  required,
  autoFocus,
  error,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  autoFocus?: boolean;
  /** Mensagem de erro deste campo — marca aria-invalid e mostra o texto logo abaixo. */
  error?: string | null;
}) {
  const errorId = id ? `${id}-error` : undefined;
  return (
    <div className="space-y-1">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="field-input"
      />
      {error && errorId && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}
