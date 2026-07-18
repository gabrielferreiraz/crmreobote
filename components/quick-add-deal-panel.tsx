"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { SidePanel } from "@/components/side-panel";
import { CurrencyInput } from "@/components/currency-input";
import { Select } from "@/components/select";
import { LoadingDots } from "@/components/loading-dots";

type Stage = { id: string; name: string; order: number };
type Pipeline = { id: string; name: string; isDefault: boolean; stages: Stage[] };
type CreditTypeOption = { id: string; label: string };
type JobTitleOption = { id: string; label: string };

/**
 * Cadastro rápido de contato + negócio a partir de uma conversa de WhatsApp
 * ainda não vinculada a nenhum Contact ("WhatsApp Geral"). Cria o Contact e,
 * em seguida, o Deal na primeira etapa do funil — duas chamadas encadeadas,
 * mesmo padrão já usado em QuickCreateContactModal + NewDealDialog. A
 * conversa se vincula sozinha ao Contact recém-criado (linkOrphanThreadsForOrganization,
 * disparado dentro de POST /api/contacts), então não precisamos repetir esse
 * passo aqui — só avisar o chamador do resultado pra ele atualizar a lista.
 */
export function QuickAddDealPanel({
  onClose,
  suggestedName,
  phoneFormatted,
  ownerId,
  ownerName,
  onCreated,
}: {
  onClose: () => void;
  suggestedName: string;
  phoneFormatted: string;
  ownerId: string;
  ownerName: string;
  onCreated: (result: { contactId: string; deal: { id: string; name: string } }) => void;
}) {
  const [pipelines, setPipelines] = useState<Pipeline[] | null>(null);
  const [pipelineId, setPipelineId] = useState("");
  const [creditTypes, setCreditTypes] = useState<CreditTypeOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState(suggestedName);
  const [value, setValue] = useState("");
  const [creditType, setCreditType] = useState("");
  const [jobTitles, setJobTitles] = useState<JobTitleOption[]>([]);
  const [jobTitle, setJobTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/pipelines");
        if (!res.ok) throw new Error();
        const data: Pipeline[] = await res.json();
        if (cancelled) return;
        setPipelines(data);
        const preferred = data.find((p) => p.isDefault) ?? data[0];
        if (preferred) setPipelineId(preferred.id);
      } catch {
        if (!cancelled) setLoadError("Não foi possível carregar os funis.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/credit-types");
        if (!res.ok) return;
        const data: CreditTypeOption[] = await res.json();
        if (!cancelled) setCreditTypes(data);
      } catch {
        // lista vazia é um degrau aceitável aqui — o campo continua opcional
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/job-titles");
        if (!res.ok) return;
        const data: JobTitleOption[] = await res.json();
        if (!cancelled) setJobTitles(data);
      } catch {
        // sem lista carregada, o Select some vazio — POST /api/contacts ainda
        // barra no servidor se o cargo não vier preenchido
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedPipeline = pipelines?.find((p) => p.id === pipelineId) ?? null;
  const firstStage = selectedPipeline?.stages.slice().sort((a, b) => a.order - b.order)[0] ?? null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstStage) return;
    setSubmitting(true);
    setError(null);

    try {
      const contactRes = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, whatsapp: phoneFormatted, jobTitle }),
      });
      const contact = await contactRes.json().catch(() => ({}));
      if (!contactRes.ok) {
        setError(contact.error ?? "Erro ao criar contato");
        return;
      }

      const dealRes = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineId: selectedPipeline!.id,
          stageId: firstStage.id,
          contactId: contact.id,
          value: value ? Number(value) : undefined,
          creditType: creditType || undefined,
          ownerId,
        }),
      });
      const deal = await dealRes.json().catch(() => ({}));
      if (!dealRes.ok) {
        setError(deal.error ?? "Contato criado, mas houve erro ao criar o negócio");
        return;
      }

      onCreated({ contactId: contact.id, deal: { id: deal.id, name: deal.name } });
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SidePanel onClose={onClose} title="Adicionar negócio">
      <form onSubmit={handleSubmit} className="flex flex-1 flex-col space-y-3">
        <div className="space-y-1">
          <label className="field-label">Nome</label>
          <input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field-input"
            placeholder="Nome do contato"
          />
        </div>
        <div className="space-y-1">
          <label className="field-label">WhatsApp</label>
          <input value={phoneFormatted} disabled className="field-input opacity-70" />
        </div>
        <div className="space-y-1">
          <label className="field-label">Cargo *</label>
          <Select
            value={jobTitle}
            onChange={setJobTitle}
            placeholder="Selecione o cargo"
            options={jobTitles.map((j) => ({ value: j.label, label: j.label }))}
          />
        </div>

        {pipelines && pipelines.length > 1 && (
          <div className="space-y-1">
            <label className="field-label">Funil</label>
            <Select
              value={pipelineId}
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
            options={[
              { value: "", label: "—" },
              ...creditTypes.map((c) => ({ value: c.label, label: c.label })),
            ]}
          />
        </div>

        <p className="text-xs text-neutral-400 dark:text-neutral-500">Responsável: {ownerName}</p>

        {(error || loadError) && (
          <p className="text-sm text-red-600 dark:text-red-400">{error ?? loadError}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button type="submit" disabled={submitting || !name.trim() || !jobTitle || !firstStage} className="btn-primary">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {submitting ? (
              <span className="inline-flex items-center gap-1">
                Criando
                <LoadingDots />
              </span>
            ) : (
              "Criar negócio"
            )}
          </button>
        </div>
      </form>
    </SidePanel>
  );
}
