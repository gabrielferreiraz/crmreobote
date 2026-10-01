"use client";

import { useEffect, useState } from "react";
import { Plus, Loader2, X } from "lucide-react";
import { Modal } from "@/components/modal";
import { CurrencyInput } from "@/components/currency-input";
import { ContactSearchInput } from "@/components/contact-search-input";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";
import { CustomFieldsFieldset, type CustomFieldDefinitionInput, type CustomFieldFormValues } from "@/components/custom-fields-fieldset";
import { readNewDealDraft, writeNewDealDraft, clearNewDealDraft } from "@/lib/new-deal-draft";
import { QuickRegisterDealForm } from "./quick-register-deal-form";
import type { Deal } from "./kanban-board";

type MemberOption = { id: string; name: string };
type CreditTypeOption = { id: string; label: string };
type JobTitleOption = { id: string; label: string };
type PipelineOption = { id: string; name: string; stages: { id: string; name: string }[] };

export function NewDealDialog({
  pipelineId,
  firstStageId,
  members,
  customFields,
  creditTypes,
  jobTitles,
  pipelines,
  onPipelineChange,
  currentUserId,
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
  jobTitles?: JobTitleOption[];
  pipelines?: PipelineOption[];
  onPipelineChange?: (pipelineId: string) => void;
  /** Pré-seleciona o próprio usuário logado como Responsável (pedido
   * explícito: "vir pré-setado o responsável do login") — ainda dá pra
   * trocar livremente, é só o valor inicial do campo. `members` sempre
   * inclui o usuário logado (ver getDealScope em lib/team-scope.ts, todo
   * papel adiciona o próprio userId ao escopo), então esse valor sempre
   * corresponde a uma opção de verdade na lista. */
  currentUserId: string;
  onCreated: (deal: Deal) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [tab, setTab] = useState<"manual" | "quick">("manual");

  // Rascunho de um fechamento acidental anterior (clique fora/Esc) — lido
  // uma vez, na montagem. Só a aba Manual é salva/restaurada (ver
  // lib/new-deal-draft.ts); a aba Cadastro rápido zera junto no X/Cancelar
  // via quickTabResetKey abaixo, mas não é persistida entre sessões — é um
  // formulário bem maior (~19 campos + análise de texto colado), fora do
  // escopo do pedido original.
  const [draftRestored] = useState(() => readNewDealDraft(pipelineId));
  const [contactId, setContactId] = useState(draftRestored?.contactId ?? "");
  // Guardado junto do id — ver comentário em lib/new-deal-draft.ts sobre por
  // quê (senão o campo de busca volta mostrando a caixa vazia).
  const [contactName, setContactName] = useState(draftRestored?.contactName ?? "");
  const [value, setValue] = useState(draftRestored?.value ?? "");
  const [grossValue, setGrossValue] = useState(draftRestored?.grossValue ?? "");
  const [creditType, setCreditType] = useState(draftRestored?.creditType ?? "");
  const [ownerId, setOwnerId] = useState(draftRestored?.ownerId || currentUserId);
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldFormValues>(draftRestored?.customFieldValues ?? {});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Força QuickRegisterDealForm a remontar do zero (todo o estado interno
  // dela reseta) quando o X/Cancelar "limpa tudo" — ver dismissClearingDraft.
  const [quickTabResetKey, setQuickTabResetKey] = useState(0);

  // Salva a cada mudança — sem debounce (poucos campos, sessionStorage é
  // local). É o que sobrevive a um fechamento ACIDENTAL (clique fora do
  // modal ou Esc); só X/Cancelar apagam de propósito (ver abaixo).
  useEffect(() => {
    writeNewDealDraft(pipelineId, { contactId, contactName, value, grossValue, creditType, ownerId, customFieldValues });
  }, [pipelineId, contactId, contactName, value, grossValue, creditType, ownerId, customFieldValues]);

  /** Modal chama isto pra clique fora/Esc — fecha SEM apagar o rascunho. */
  function dismissKeepingDraft() {
    setOpen(false);
  }

  /** X e "Cancelar" (nas duas abas) — únicas ações que significam "não quero mais criar isto". */
  function dismissClearingDraft() {
    clearNewDealDraft(pipelineId);
    setContactId("");
    setContactName("");
    setValue("");
    setGrossValue("");
    setCreditType("");
    setOwnerId(currentUserId);
    setCustomFieldValues({});
    setQuickTabResetKey((n) => n + 1);
    setTab("manual");
    setOpen(false);
  }

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
      // Negócio criado de verdade — o rascunho não serve mais pra próxima vez.
      clearNewDealDraft(pipelineId);
      setContactId("");
      setContactName("");
      setValue("");
      setGrossValue("");
      setCreditType("");
      setOwnerId(currentUserId);
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
        // onClose aqui é dismissKeepingDraft — clique fora/Esc mantêm o
        // rascunho; só o X (abaixo) e "Cancelar" (nas duas abas) apagam de
        // verdade. Pedido explícito: "pode ser que o consultor clicou
        // errado e acabou fechando a tela de cadastro de negócio e pessoa".
        <Modal onClose={dismissKeepingDraft} maxWidth="max-w-xl">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Novo negócio</h2>
            <button
              type="button"
              onClick={dismissClearingDraft}
              className="icon-btn -mt-1 -mr-1 h-8 w-8 shrink-0"
              aria-label="Fechar e descartar"
              title="Fechar e descartar o que foi digitado"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          {pipelines && pipelines.length > 1 && onPipelineChange && (
            <div className="mb-4 space-y-1">
              <label className="field-label">Funil</label>
              <Select
                value={pipelineId}
                onChange={onPipelineChange}
                options={pipelines.map((pipeline) => ({ value: pipeline.id, label: pipeline.name }))}
              />
            </div>
          )}

          {!firstStageId && (
            <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
              Este funil ainda não possui uma etapa para receber o negócio.
            </p>
          )}

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
              // Força remontar (zera os ~19 campos internos dela) quando o
              // X/Cancelar "limpa tudo" — ver quickTabResetKey acima.
              key={quickTabResetKey}
              pipelineId={pipelineId}
              firstStageId={firstStageId}
              members={members}
              creditTypes={creditTypes}
              jobTitles={jobTitles}
              currentUserId={currentUserId}
              onCreated={(deal) => {
                setOpen(false);
                setTab("manual");
                // Negócio criado pela OUTRA aba — um rascunho da Manual que
                // tivesse sobrado não serve mais.
                clearNewDealDraft(pipelineId);
                onCreated(deal);
              }}
              onCancel={dismissClearingDraft}
            />
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1">
                <label className="field-label">Contato</label>
                <ContactSearchInput
                  value={contactId}
                  selectedLabel={contactName}
                  onChange={(id, contact) => {
                    setContactId(id);
                    setContactName(contact?.name ?? "");
                  }}
                  autoFocus
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
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
              </div>
              <CustomFieldsFieldset definitions={customFields} values={customFieldValues} onChange={setCustomFieldValues} />

              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={dismissClearingDraft} className="btn-ghost">
                  Cancelar
                </button>
                <button type="submit" disabled={loading || !contactId || !firstStageId} className="btn-primary">
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
