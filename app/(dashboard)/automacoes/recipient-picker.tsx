"use client";

import { useState } from "react";
import { Plus, X, Check } from "lucide-react";
import { Select } from "@/components/select";
import type { RecipientEntry } from "@/lib/automations/recipients";

export type { RecipientEntry };

type MemberOption = { id: string; name: string };

type RecipientType = RecipientEntry["type"];

// O tipo interno "ADMIN" continua com esse nome (compatível com destinatários
// já salvos em regras existentes — ver lib/automations/recipients.ts), mas o
// papel que hoje corresponde a "uma pessoa específica com poder administrativo"
// é o Gerente.
const TYPE_LABELS: Record<RecipientType, string> = {
  CLIENT: "Cliente",
  RESPONSIBLE: "Responsável",
  SUPERVISOR: "Supervisor (líder da equipe)",
  ADMIN: "Gerente",
  OWNER: "Dono",
  CUSTOM: "Personalizado",
};

/**
 * Lista de destinatários das ações "Enviar WhatsApp"/"Enviar e-mail" das
 * automações — compartilhado pelas duas, só muda o rótulo/placeholder do
 * campo "personalizado" (número vs e-mail) e quais tipos ficam disponíveis
 * (WhatsApp não oferece "Responsável": mandar mensagem pra si mesmo não faz
 * sentido, esse caso já é coberto pela ação "Enviar notificação push").
 */
export function RecipientPicker({
  recipients,
  onChange,
  availableTypes,
  admins,
  owners,
  memberById,
  customLabel,
  customPlaceholder,
}: {
  recipients: RecipientEntry[];
  onChange: (next: RecipientEntry[]) => void;
  availableTypes: RecipientType[];
  admins: MemberOption[];
  owners: MemberOption[];
  memberById: Map<string, string>;
  customLabel: string;
  customPlaceholder: string;
}) {
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"ADMIN" | "OWNER" | "CUSTOM" | null>(null);
  const [customValue, setCustomValue] = useState("");

  function labelFor(entry: RecipientEntry): string {
    if (entry.type === "ADMIN" || entry.type === "OWNER") {
      return `${TYPE_LABELS[entry.type]}: ${memberById.get(entry.userId) ?? "usuário removido"}`;
    }
    if (entry.type === "CUSTOM") return entry.value;
    return TYPE_LABELS[entry.type];
  }

  function remove(index: number) {
    onChange(recipients.filter((_, i) => i !== index));
  }

  function add(entry: RecipientEntry) {
    onChange([...recipients, entry]);
    setAddMenuOpen(false);
    setPickerMode(null);
    setCustomValue("");
  }

  const hasClient = recipients.some((r) => r.type === "CLIENT");
  const hasResponsible = recipients.some((r) => r.type === "RESPONSIBLE");
  const hasSupervisor = recipients.some((r) => r.type === "SUPERVISOR");

  return (
    <div className="space-y-1.5">
      <label className="field-label">Destinatários</label>

      {recipients.length > 0 && (
        <div className="space-y-1">
          {recipients.map((entry, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm dark:border-neutral-800"
            >
              <span className="truncate text-neutral-700 dark:text-neutral-300">{labelFor(entry)}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                className="icon-btn shrink-0"
                aria-label="Remover destinatário"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      )}

      {pickerMode === "ADMIN" && (
        <div className="flex items-center gap-1.5">
          <Select
            value=""
            onChange={(v) => v && add({ type: "ADMIN", userId: v })}
            placeholder="Escolha o gerente"
            options={admins.map((a) => ({ value: a.id, label: a.name }))}
          />
          <button type="button" onClick={() => setPickerMode(null)} className="icon-btn shrink-0" aria-label="Cancelar">
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      )}

      {pickerMode === "OWNER" && (
        <div className="flex items-center gap-1.5">
          <Select
            value=""
            onChange={(v) => v && add({ type: "OWNER", userId: v })}
            placeholder="Escolha o dono"
            options={owners.map((o) => ({ value: o.id, label: o.name }))}
          />
          <button type="button" onClick={() => setPickerMode(null)} className="icon-btn shrink-0" aria-label="Cancelar">
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      )}

      {pickerMode === "CUSTOM" && (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            placeholder={customPlaceholder}
            className="field-input"
          />
          <button
            type="button"
            onClick={() => customValue.trim() && add({ type: "CUSTOM", value: customValue.trim() })}
            className="icon-btn shrink-0"
            aria-label="Adicionar"
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
          <button type="button" onClick={() => setPickerMode(null)} className="icon-btn shrink-0" aria-label="Cancelar">
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      )}

      {!pickerMode && (
        <div className="relative">
          <button type="button" onClick={() => setAddMenuOpen((v) => !v)} className="btn-ghost btn-sm">
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            Adicionar destinatário
          </button>
          {addMenuOpen && (
            <div className="surface-glass animate-pop-in absolute z-30 mt-1 w-56 rounded-md p-1 shadow-lg">
              {availableTypes.includes("CLIENT") && !hasClient && (
                <button
                  type="button"
                  onClick={() => add({ type: "CLIENT" })}
                  className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  {TYPE_LABELS.CLIENT}
                </button>
              )}
              {availableTypes.includes("RESPONSIBLE") && !hasResponsible && (
                <button
                  type="button"
                  onClick={() => add({ type: "RESPONSIBLE" })}
                  className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  {TYPE_LABELS.RESPONSIBLE}
                </button>
              )}
              {availableTypes.includes("SUPERVISOR") && !hasSupervisor && (
                <button
                  type="button"
                  onClick={() => add({ type: "SUPERVISOR" })}
                  className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  {TYPE_LABELS.SUPERVISOR}
                </button>
              )}
              {availableTypes.includes("ADMIN") && (
                <button
                  type="button"
                  disabled={admins.length === 0}
                  onClick={() => {
                    setPickerMode("ADMIN");
                    setAddMenuOpen(false);
                  }}
                  className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  {TYPE_LABELS.ADMIN}
                </button>
              )}
              {availableTypes.includes("OWNER") && (
                <button
                  type="button"
                  disabled={owners.length === 0}
                  onClick={() => {
                    setPickerMode("OWNER");
                    setAddMenuOpen(false);
                  }}
                  className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  {TYPE_LABELS.OWNER}
                </button>
              )}
              {availableTypes.includes("CUSTOM") && (
                <button
                  type="button"
                  onClick={() => {
                    setPickerMode("CUSTOM");
                    setAddMenuOpen(false);
                  }}
                  className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  {customLabel}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
