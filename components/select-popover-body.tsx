"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Select } from "@/components/select";

/**
 * Corpo padrão dos popovers de ação em massa que só precisam de um Select +
 * botão de aplicar (trocar cargo/origem/responsável/funil/etapa...) —
 * compartilhado entre Clientes e Negócios. `allowEmpty` deixa aplicar com o
 * valor "" (só faz sentido quando "" é uma escolha válida, tipo "Ninguém"
 * pra responsável) — nos outros casos, "" é só o placeholder de "nada
 * selecionado ainda" e não deve aplicar.
 */
export function SelectPopoverBody({
  busy,
  options,
  onApply,
  allowEmpty = false,
  initialValue = "",
  applyLabel = "Aplicar",
}: {
  busy: boolean;
  options: { value: string; label: string }[];
  onApply: (value: string) => Promise<void>;
  allowEmpty?: boolean;
  initialValue?: string;
  applyLabel?: string;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <div className="space-y-2">
      <Select value={value} onChange={setValue} className="w-full py-1.5 text-sm" options={options} />
      <button
        type="button"
        disabled={busy || (!allowEmpty && !value)}
        onClick={() => onApply(value)}
        className="btn-primary w-full py-1.5 text-xs"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} /> : applyLabel}
      </button>
    </div>
  );
}
