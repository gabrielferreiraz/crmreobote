"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Modal } from "@/components/modal";
import { CurrencyInput } from "@/components/currency-input";
import { Select } from "@/components/select";
import { LoadingDots } from "@/components/loading-dots";

type PipelineOption = { id: string; name: string; stages: { id: string; name: string }[] };
type MemberOption = { id: string; name: string };
type CreditTypeOption = { id: string; label: string };

export type CreatedDeal = { id: string; name: string; status: "OPEN" | "WON" | "LOST"; value: number | null; stageName: string };

/**
 * Versão ENXUTA do "Novo negócio" da Pipeline (ver
 * app/(dashboard)/pipeline/new-deal-dialog.tsx) — sem campo de busca de
 * contato (já estamos na página DELE, não faz sentido perguntar de novo),
 * sem a aba "Cadastro rápido" (que cria um CONTATO novo — aqui o contato já
 * existe), sem campos personalizados (o botão pede "simples", ver o pedido).
 * Só o essencial: funil (só aparece se tiver mais de um, mesmo padrão do
 * seletor em pipeline-view.tsx), valor, tipo de crédito, responsável.
 */
export function CreateDealForContactDialog({
  contactId,
  pipelines,
  members,
  creditTypes,
  onCreated,
}: {
  contactId: string;
  pipelines: PipelineOption[];
  members: MemberOption[];
  creditTypes: CreditTypeOption[];
  onCreated: (deal: CreatedDeal) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? "");
  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? pipelines[0];
  const firstStageId = pipeline?.stages[0]?.id;
  const [value, setValue] = useState("");
  const [creditType, setCreditType] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sem pipeline/etapa nenhuma cadastrada na organização — não tem onde
  // criar o negócio. Caso de borda (organização recém-criada sem setup
  // ainda), mas evita um botão que sempre falha ao submeter.
  if (!pipeline || !firstStageId) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstStageId || !pipeline) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineId: pipeline.id,
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
      setValue("");
      setCreditType("");
      setOwnerId("");
      onCreated({
        id: data.id,
        name: data.name,
        status: data.status,
        value: data.value != null ? Number(data.value) : null,
        stageName: data.stage.name,
      });
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-primary btn-sm">
        <Plus className="h-4 w-4" strokeWidth={2.5} />
        Novo negócio
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)} maxWidth="max-w-sm">
          <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Novo negócio</h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            {pipelines.length > 1 && (
              <div className="space-y-1">
                <label className="field-label">Funil</label>
                <Select
                  value={pipeline.id}
                  onChange={setPipelineId}
                  options={pipelines.map((p) => ({ value: p.id, label: p.name }))}
                />
              </div>
            )}
            <div className="space-y-1">
              <label className="field-label">Valor</label>
              <CurrencyInput value={value} onChange={setValue} />
            </div>
            <div className="space-y-1">
              <label className="field-label">Tipo de crédito</label>
              <Select
                value={creditType}
                onChange={setCreditType}
                options={[{ value: "", label: "—" }, ...creditTypes.map((c) => ({ value: c.label, label: c.label }))]}
              />
            </div>
            <div className="space-y-1">
              <label className="field-label">Responsável</label>
              <Select
                value={ownerId}
                onChange={setOwnerId}
                options={[{ value: "", label: "Atribuição automática" }, ...members.map((m) => ({ value: m.id, label: m.name }))]}
              />
            </div>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
                Cancelar
              </button>
              <button type="submit" disabled={loading} className="btn-primary">
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
