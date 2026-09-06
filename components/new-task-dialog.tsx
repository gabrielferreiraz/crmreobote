"use client";

/**
 * Extraído de app/(dashboard)/agenda/tasks-list.tsx (mesmo componente,
 * mesmo comportamento) pra poder ser reaproveitado de outros lugares que
 * também precisam de "criar tarefa rápida" — hoje: Agenda (desktop e
 * mobile, contato/negócio livres) e o painel de Informações da conversa de
 * WhatsApp (contato — e opcionalmente negócio — já fixos, ver
 * `fixedContact`/`initialDealId` abaixo).
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/modal";
import { ContactSearchInput } from "@/components/contact-search-input";
import { MeetingInviteDialog, type MeetingInviteTask } from "@/components/meeting-invite-dialog";
import { ScheduleMessageDialog, type ScheduleMessageTask } from "@/components/schedule-message-dialog";
import { VoiceInputButton, appendDictatedText } from "@/components/voice-input-button";
import { useVoiceTranscription } from "@/lib/use-voice-transcription";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";
import { TASK_TYPE_LABELS } from "@/lib/task-icons";
import type { Option } from "@/app/(dashboard)/agenda/tasks-list";

export function NewTaskDialog({
  deals,
  isWhatsAppConnected,
  onClose,
  onCreated,
  fixedContact,
  initialDealId,
}: {
  deals: Option[];
  /** Sem isso, o passo de convite (ver meetingInviteTask abaixo) nem oferece a opção de enviar. */
  isWhatsAppConnected?: boolean;
  onClose: () => void;
  onCreated: () => void;
  /** Quando informado, o campo Contato vem fixo (sem seletor) — usado ao
   * criar a tarefa a partir de um contexto que já sabe o contato de sobra
   * (ex.: painel de Informações da conversa de WhatsApp). Sem isso, o
   * comportamento é o de sempre: ContactSearchInput livre. */
  fixedContact?: { id: string; name: string };
  /** Pré-seleciona um negócio no dropdown (ex.: o único negócio aberto
   * deste contato) — a pessoa ainda pode trocar antes de criar. */
  initialDealId?: string;
}) {
  // Ditado por voz mostra o texto ao vivo enquanto a pessoa fala (ver
  // lib/use-voice-transcription.ts) — `title`/`description` continuam
  // sendo o valor de VERDADE (confirmado, sem provisório em andamento),
  // pra submissão/validação abaixo não mudar; só os campos em si usam
  // `.value` (com o provisório) pra dar o feedback visual.
  const titleDictation = useVoiceTranscription("", appendDictatedText);
  const title = titleDictation.committed;
  const setTitle = titleDictation.setValue;
  const [type, setType] = useState("CALL");
  const [dueAt, setDueAt] = useState("");
  const descriptionDictation = useVoiceTranscription("", appendDictatedText);
  const description = descriptionDictation.committed;
  const setDescription = descriptionDictation.setValue;
  const [contactId, setContactId] = useState(fixedContact?.id ?? "");
  const [dealId, setDealId] = useState(initialDealId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Setado só quando a tarefa recém-criada é uma Reunião com data e cliente
  // vinculado — troca o formulário pelo MeetingInviteDialog em vez de fechar
  // na hora (ver render abaixo).
  const [meetingInviteTask, setMeetingInviteTask] = useState<MeetingInviteTask | null>(null);
  // Mesma ideia, pra tarefa WhatsApp com prazo FUTURO e cliente vinculado —
  // troca pelo ScheduleMessageDialog (ver components/schedule-message-dialog.tsx).
  const [scheduleMessageTask, setScheduleMessageTask] = useState<ScheduleMessageTask | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        type,
        description: description || undefined,
        dueAt: dueAt || undefined,
        contactId: contactId || undefined,
        dealId: dealId || undefined,
      }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao criar atividade");
      return;
    }

    const created = await res.json();
    if (created.type === "MEETING" && created.dueAt && created.contact) {
      setMeetingInviteTask({
        id: created.id,
        title: created.title,
        dueAt: created.dueAt,
        contact: { id: created.contact.id, name: created.contact.name, phone: created.contact.phone, whatsapp: created.contact.whatsapp },
        owner: { id: created.owner.id, name: created.owner.name },
        ownerHasGoogleCalendarWriteAccess: !!created.ownerGoogleCalendarWriteConnected,
      });
      return;
    }
    if (created.type === "WHATSAPP" && created.dueAt && created.contact && new Date(created.dueAt) > new Date()) {
      setScheduleMessageTask({
        id: created.id,
        title: created.title,
        dueAt: created.dueAt,
        contact: {
          id: created.contact.id,
          name: created.contact.name,
          jobTitle: created.contact.jobTitle,
          company: created.contact.company,
          city: created.contact.city,
          phone: created.contact.phone,
          whatsapp: created.contact.whatsapp,
        },
      });
      return;
    }

    onCreated();
  }

  if (meetingInviteTask) {
    return (
      <MeetingInviteDialog
        task={meetingInviteTask}
        isWhatsAppConnected={!!isWhatsAppConnected}
        onClose={onCreated}
      />
    );
  }

  if (scheduleMessageTask) {
    return <ScheduleMessageDialog task={scheduleMessageTask} onClose={onCreated} />;
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Nova atividade</h2>
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
          <label className="field-label">Tipo</label>
          <Select
            value={type}
            onChange={setType}
            options={Object.entries(TASK_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
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
        {fixedContact ? (
          <div className="space-y-1">
            <label className="field-label">Contato</label>
            <p className="field-input flex items-center text-neutral-700 dark:text-neutral-300">{fixedContact.name}</p>
          </div>
        ) : (
          <div className="space-y-1">
            <label className="field-label">Contato (opcional)</label>
            <ContactSearchInput value={contactId} onChange={(id) => setContactId(id)} />
          </div>
        )}
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
  );
}
