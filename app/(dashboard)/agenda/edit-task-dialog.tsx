"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/modal";
import { ContactSearchInput } from "@/components/contact-search-input";
import { Select } from "@/components/select";
import { VoiceInputButton, appendDictatedText } from "@/components/voice-input-button";
import { useVoiceTranscription } from "@/lib/use-voice-transcription";
import { LoadingDots } from "@/components/loading-dots";
import type { Task } from "./task-row";
import type { Option } from "./tasks-list";

/** Formata um Date/string ISO pro formato que <input type="datetime-local">
 * espera ("YYYY-MM-DDTHH:mm", hora LOCAL do navegador) — mesma conversão que
 * o campo já precisa fazer em qualquer form com prazo pré-preenchido. */
function toDateTimeLocalValue(date: string | Date | null): string {
  if (!date) return "";
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Editar uma tarefa/visita já existente — título, prazo, negócio vinculado
 * ("trocar de negócio"), contato e descrição. Pedido explícito: qualquer
 * papel com acesso à tarefa pode editar (já valia no backend — PUT
 * /api/tasks/[id] nunca foi restrito a Dono, só faltava esta UI; ver
 * TaskDetailModal, que agora abre isto a partir do botão "Editar").
 *
 * `type` fica de FORA de propósito — trocar o tipo (ex.: Ligação → Reunião)
 * mexe em toda a máquina de Activity/meetingOutcome vinculada (ver PUT
 * /api/tasks/[id]/route.ts), risco desproporcional ao pedido ("editar a
 * visita", não "trocar o tipo da tarefa"); quem precisar disso hoje ainda
 * pode excluir e recriar.
 */
export function EditTaskDialog({
  task,
  deals,
  onClose,
  onSaved,
}: {
  task: Task;
  deals: Option[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const titleDictation = useVoiceTranscription(task.title, appendDictatedText);
  const title = titleDictation.committed;
  const setTitle = titleDictation.setValue;
  const [dueAt, setDueAt] = useState(toDateTimeLocalValue(task.dueAt));
  const descriptionDictation = useVoiceTranscription(task.description ?? "", appendDictatedText);
  const description = descriptionDictation.committed;
  const setDescription = descriptionDictation.setValue;
  const [contactId, setContactId] = useState(task.contact?.id ?? "");
  const [dealId, setDealId] = useState(task.deal?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description: description || null,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        dealId: dealId || null,
        contactId: contactId || null,
      }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao salvar alterações");
      return;
    }

    router.refresh();
    onSaved();
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Editar atividade</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label className="field-label">Título</label>
            <VoiceInputButton onResult={titleDictation.onResult} onInterimResult={titleDictation.onInterimResult} />
          </div>
          <input
            autoFocus
            required
            value={titleDictation.value}
            onChange={(e) => setTitle(e.target.value)}
            className="field-input"
          />
        </div>
        <div className="space-y-1">
          <label className="field-label">Prazo</label>
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="field-input"
          />
        </div>
        <div className="space-y-1">
          <label className="field-label">Negócio (opcional)</label>
          <Select
            value={dealId}
            onChange={setDealId}
            options={[{ value: "", label: "—" }, ...deals.map((d) => ({ value: d.id, label: d.name }))]}
          />
        </div>
        <div className="space-y-1">
          <label className="field-label">Contato (opcional)</label>
          <ContactSearchInput value={contactId} selectedLabel={task.contact?.name} onChange={(id) => setContactId(id)} />
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label className="field-label">Descrição</label>
            <VoiceInputButton onResult={descriptionDictation.onResult} onInterimResult={descriptionDictation.onInterimResult} />
          </div>
          <textarea
            value={descriptionDictation.value}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="field-input"
          />
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button type="submit" disabled={loading || !title.trim()} className="btn-primary">
            {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {loading ? (
              <span className="inline-flex items-center gap-1">
                Salvando
                <LoadingDots />
              </span>
            ) : (
              "Salvar"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
