"use client";

import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { Modal } from "@/components/modal";
import { CurrencyInput } from "@/components/currency-input";
import { ContactSearchInput } from "@/components/contact-search-input";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";
import type { Deal } from "./kanban-board";

type MemberOption = { id: string; name: string };

export function NewDealDialog({
  pipelineId,
  firstStageId,
  members,
  onCreated,
  open,
  onOpenChange,
}: {
  pipelineId: string;
  firstStageId?: string;
  members: MemberOption[];
  onCreated: (deal: Deal) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [contactId, setContactId] = useState("");
  const [value, setValue] = useState("");
  const [creditType, setCreditType] = useState("");
  const [ownerId, setOwnerId] = useState("");
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
          creditType: creditType || undefined,
          ownerId: ownerId || undefined,
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
      setCreditType("");
      setOwnerId("");
      onCreated({
        ...data,
        value: data.value != null ? Number(data.value) : null,
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
      <button onClick={() => setOpen(true)} className="btn-primary">
        <Plus className="h-4 w-4" strokeWidth={2.5} />
        Novo negócio
      </button>

      {isOpen && (
        <Modal onClose={() => setOpen(false)}>
          <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Novo negócio</h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <label className="field-label">Contato</label>
              <ContactSearchInput value={contactId} onChange={(id) => setContactId(id)} autoFocus />
            </div>
            <div className="space-y-1">
              <label className="field-label">Valor</label>
              <CurrencyInput value={value} onChange={setValue} />
            </div>
            <div className="space-y-1">
              <label className="field-label">Tipo de crédito</label>
              <Select
                value={creditType}
                onChange={setCreditType}
                options={[
                  { value: "", label: "—" },
                  { value: "IMÓVEL", label: "Imóvel" },
                  { value: "VEÍCULO", label: "Veículo" },
                  { value: "OUTROS", label: "Outros" },
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
        </Modal>
      )}
    </>
  );
}
