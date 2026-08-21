"use client";

import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { Modal } from "@/components/modal";
import { CurrencyInput } from "@/components/currency-input";
import { ContactSearchInput } from "@/components/contact-search-input";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";
import { CustomFieldsFieldset, type CustomFieldDefinitionInput, type CustomFieldFormValues } from "@/components/custom-fields-fieldset";
import { QuickRegisterDealForm } from "./quick-register-deal-form";
import type { Deal } from "./kanban-board";

type MemberOption = { id: string; name: string };
type CreditTypeOption = { id: string; label: string };

export function NewDealDialog({
  pipelineId,
  firstStageId,
  members,
  customFields,
  creditTypes,
  onCreated,
  open,
  onOpenChange,
  hideTrigger,
}: {
  pipelineId: string;
  firstStageId?: string;
  members: MemberOption[];
  customFields: CustomFieldDefinitionInput[];
  creditTypes: CreditTypeOption[];
  onCreated: (deal: Deal) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [tab, setTab] = useState<"manual" | "quick">("manual");
  const [contactId, setContactId] = useState("");
  const [value, setValue] = useState("");
  const [grossValue, setGrossValue] = useState("");
  const [creditType, setCreditType] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldFormValues>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstStageId) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineId,
          stageId: firstStageId,
          contactId,
          value: value ? Number(value) : undefined,
          grossValue: grossValue ? Number(grossValue) : undefined,
          creditType: creditType || undefined,
          ownerId: ownerId || undefined,
          customFieldValues,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? "Erro ao criar negócio");
        return;
      }

      setOpen(false);
      setContactId("");
      setValue("");
      setGrossValue("");
      setCreditType("");
      setOwnerId("");
      setCustomFieldValues({});
      onCreated({
        ...data,
        value: data.value != null ? Number(data.value) : null,
        grossValue: data.grossValue != null ? Number(data.grossValue) : null,
        owner: { id: data.owner.id, name: data.owner.name, photoUrl: null },
        nextActivity: null,
        taskTypes: [],
      });
    } catch {
      setError("Falha de conexão ao criar negócio. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {!hideTrigger && (
        <button onClick={() => setOpen(true)} className="btn-primary">
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Novo negócio
        </button>
      )}

      {isOpen && (
        // Largura fixa pras duas abas — se dependesse da aba (Manual bem mais
        // estreito que Cadastro rápido), o modal (centralizado na tela)
        // mudava de tamanho ao trocar de aba e a própria seleção de aba
        // "pulava" de lugar, obrigando a mover o mouse pra clicar de novo.
        <Modal onClose={() => setOpen(false)} maxWidth="max-w-xl">
          <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Novo negócio</h2>

          <div className="mb-4 inline-flex rounded-lg bg-neutral-100 p-1 text-sm dark:bg-neutral-800">
            <button
              type="button"
              onClick={() => setTab("manual")}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                tab === "manual"
                  ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
                  : "text-neutral-500 dark:text-neutral-400"
              }`}
            >
              Manual
            </button>
            <button
              type="button"
              onClick={() => setTab("quick")}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                tab === "quick"
                  ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
                  : "text-neutral-500 dark:text-neutral-400"
              }`}
            >
              Cadastro rápido
            </button>
          </div>

          {tab === "quick" ? (
            <QuickRegisterDealForm
              pipelineId={pipelineId}
              firstStageId={firstStageId}
              members={members}
              creditTypes={creditTypes}
              onCreated={(deal) => {
                setOpen(false);
                setTab("manual");
                onCreated(deal);
              }}
              onCancel={() => setOpen(false)}
            />
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1">
                <label className="field-label">Contato</label>
                <ContactSearchInput value={contactId} onChange={(id) => setContactId(id)} autoFocus />
              </div>
              <div className="space-y-1">
                <label className="field-label">Valor líquido</label>
                <CurrencyInput value={value} onChange={setValue} />
              </div>
              <div className="space-y-1">
                <label className="field-label">Valor bruto</label>
                <CurrencyInput value={grossValue} onChange={setGrossValue} />
              </div>
              <div className="space-y-1">
                <label className="field-label">Tipo de crédito</label>
                <Select
                  value={creditType}
                  onChange={setCreditType}
                  options={[
                    { value: "", label: "—" },
                    ...creditTypes.map((c) => ({ value: c.label, label: c.label })),
                  ]}
                />
              </div>
              <div className="space-y-1">
                <label className="field-label">Responsável</label>
                <Select
                  value={ownerId}
                  onChange={setOwnerId}
                  options={[
                    { value: "", label: "Atribuição automática" },
                    ...members.map((m) => ({ value: m.id, label: m.name })),
                  ]}
                />
              </div>
              <CustomFieldsFieldset definitions={customFields} values={customFieldValues} onChange={setCustomFieldValues} />

              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
                  Cancelar
                </button>
                <button type="submit" disabled={loading || !contactId} className="btn-primary">
                  {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
                  {loading ? (
                    <span className="inline-flex items-center gap-1">
                      Criando
                      <LoadingDots />
                    </span>
                  ) : (
                    "Criar"
                  )}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
