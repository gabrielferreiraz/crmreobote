"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Send, CheckCheck, History, Phone, Mail, MapPin, Building2, StickyNote, Clock, Trash2, FileText } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/badge";
import { Select } from "@/components/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatCurrency, daysSince } from "@/lib/format";
import { getStageSlaStatus } from "@/lib/processes/sla";
import { DOCUMENT_STATUS_LABELS, type DocumentStatus } from "../document-status";
import { SendTemplateDialog } from "./send-template-dialog";

type Stage = { id: string; name: string; color: string | null; isFinal: boolean; slaBusinessDays: number | null };

type ProcessFull = {
  id: string;
  pipelineId: string;
  stageId: string;
  stage: { id: string; name: string; color: string | null; slaBusinessDays: number | null };
  pipeline: { stages: Stage[] };
  documentStatus: DocumentStatus;
  quotaNumber: string | null;
  groupNumber: string | null;
  stageEnteredAt: string | Date;
  createdAt: string | Date;
  contact: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
    company: string | null;
    city: string | null;
    address: string | null;
    addressNumber: string | null;
    addressComplement: string | null;
    neighborhood: string | null;
    state: string | null;
    zipCode: string | null;
  };
  owner: { id: string; name: string; photoUrl: string | null };
  deal: { id: string; name: string; value: number | null; creditType: string | null; closedAt: string | Date | null };
};

type HistoryEntry = {
  id: string;
  changedAt: string;
  changedBy: { id: string; name: string };
  fromStage: { id: string; name: string; color: string | null } | null;
  toStage: { id: string; name: string; color: string | null };
};

type RequestEntry = {
  id: string;
  message: string;
  createdAt: string;
  resolvedAt: string | null;
  requestedBy: { id: string; name: string };
  /** Preenchido só quando o administrativo mandou (ver "Enviar modelo") — quem precisa resolver esta. Null = direção de sempre, consultor avisando o administrativo. */
  targetUserId: string | null;
  resolvedBy: { id: string; name: string } | null;
};

type NoteEntry = {
  id: string;
  body: string | null;
  createdAt: string;
  user: { id: string; name: string };
};

function fullAddress(contact: ProcessFull["contact"]): string | null {
  const parts = [
    contact.address && contact.addressNumber ? `${contact.address}, ${contact.addressNumber}` : contact.address,
    contact.addressComplement,
    contact.neighborhood,
    contact.city && contact.state ? `${contact.city}/${contact.state}` : contact.city,
    contact.zipCode,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" — ") : null;
}

export function ProcessDetail({ process: initialProcess, isAdmin }: { process: ProcessFull; isAdmin: boolean }) {
  const router = useRouter();
  const [process, setProcess] = useState(initialProcess);
  const [quotaInput, setQuotaInput] = useState(initialProcess.quotaNumber ?? "");
  const [groupInput, setGroupInput] = useState(initialProcess.groupNumber ?? "");
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [requests, setRequests] = useState<RequestEntry[] | null>(null);
  const [newRequestMessage, setNewRequestMessage] = useState("");
  const [sendingRequest, setSendingRequest] = useState(false);
  const [notes, setNotes] = useState<NoteEntry[] | null>(null);
  const [newNoteBody, setNewNoteBody] = useState("");
  const [sendingNote, setSendingNote] = useState(false);
  const [saving, setSaving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [showSendTemplate, setShowSendTemplate] = useState(false);

  function reloadRequests() {
    fetch(`/api/processes/${process.id}/requests`)
      .then((r) => r.json())
      .then(setRequests);
  }

  function reloadNotes() {
    fetch(`/api/processes/${process.id}/activities`)
      .then((r) => r.json())
      .then(setNotes);
  }

  useEffect(() => {
    fetch(`/api/processes/${process.id}/history`)
      .then((r) => r.json())
      .then(setHistory);
    reloadRequests();
    reloadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [process.id]);

  async function updateMarkers(data: {
    documentStatus?: DocumentStatus;
    quotaNumber?: string | null;
    groupNumber?: string | null;
  }) {
    setSaving(true);
    setError(null);
    setProcess((prev) => ({ ...prev, ...data }));
    const res = await fetch(`/api/processes/${process.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Erro ao salvar");
      return;
    }
    router.refresh();
  }

  async function moveStage(stageId: string) {
    if (stageId === process.stageId) return;
    setMoveError(null);
    const previousStage = process.stage;
    const targetStage = process.pipeline.stages.find((s) => s.id === stageId);
    setProcess((prev) => (targetStage ? { ...prev, stageId, stage: targetStage } : prev));

    const res = await fetch(`/api/processes/${process.id}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId }),
    });

    if (!res.ok) {
      setProcess((prev) => ({ ...prev, stageId: previousStage.id, stage: previousStage }));
      const body = await res.json().catch(() => ({}));
      setMoveError(body.error ?? "Não foi possível mover o processo");
      return;
    }
    setHistory(null);
    fetch(`/api/processes/${process.id}/history`)
      .then((r) => r.json())
      .then(setHistory);
    router.refresh();
  }

  async function sendRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!newRequestMessage.trim()) return;
    setSendingRequest(true);
    setError(null);
    const res = await fetch(`/api/processes/${process.id}/requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: newRequestMessage.trim() }),
    });
    setSendingRequest(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Erro ao enviar solicitação");
      return;
    }
    const created = await res.json();
    setRequests((prev) => [created, ...(prev ?? [])]);
    setNewRequestMessage("");
  }

  async function sendNote(e: React.FormEvent) {
    e.preventDefault();
    if (!newNoteBody.trim()) return;
    setSendingNote(true);
    setError(null);
    const res = await fetch(`/api/processes/${process.id}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activityBody: newNoteBody.trim() }),
    });
    setSendingNote(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Erro ao registrar anotação");
      return;
    }
    const created = await res.json();
    setNotes((prev) => [created, ...(prev ?? [])]);
    setNewNoteBody("");
  }

  async function resolveRequest(requestId: string) {
    const res = await fetch(`/api/processes/requests/${requestId}`, { method: "PATCH" });
    if (!res.ok) return;
    const updated = await res.json();
    setRequests((prev) => (prev ?? []).map((r) => (r.id === requestId ? updated : r)));
  }

  /** Pra quando o administrativo adicionou o negócio errado por engano — o
   * negócio em si não é tocado, só sai do processo (some junto o histórico
   * de etapa/solicitações/anotações DESTE processo). Volta a aparecer na
   * busca de "Adicionar ao processo" normalmente. */
  async function removeFromProcess() {
    setError(null);
    const res = await fetch(`/api/processes/${process.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Erro ao remover do processo");
      return;
    }
    router.push("/processos");
    router.refresh();
  }

  const address = fullAddress(process.contact);
  const unresolvedRequests = (requests ?? []).filter((r) => !r.resolvedAt);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/processos"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          Processos
        </Link>

        {isAdmin && (
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setShowSendTemplate(true)} className="btn-secondary btn-sm">
              <FileText className="h-3.5 w-3.5" strokeWidth={2} />
              Enviar modelo
            </button>
            <button
              type="button"
              onClick={() => setShowRemoveConfirm(true)}
              className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-red-600 dark:text-neutral-500 dark:hover:text-red-400"
              title="Remove o negócio deste processo — o negócio em si não é afetado, só sai do acompanhamento de pós-venda"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              Remover do processo
            </button>
          </div>
        )}
      </div>

      {showSendTemplate && (
        <SendTemplateDialog
          process={{ id: process.id, contact: process.contact, owner: process.owner, deal: process.deal }}
          onClose={() => setShowSendTemplate(false)}
          onSent={() => {
            reloadRequests();
            reloadNotes();
          }}
        />
      )}

      {showRemoveConfirm && (
        <ConfirmDialog
          title="Remover este negócio do processo?"
          description="O negócio continua Ganho — só sai do acompanhamento de pós-venda (histórico, solicitações e anotações somem junto). Dá pra adicionar de novo em “Adicionar ao processo”, se for engano. Não pode ser desfeita."
          confirmLabel="Remover"
          onClose={() => setShowRemoveConfirm(false)}
          onConfirm={removeFromProcess}
        />
      )}

      <div className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">{process.contact.name}</h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
              <span>
                {process.deal.name} · {formatCurrency(process.deal.value)}
                {process.deal.creditType && ` · ${process.deal.creditType}`}
              </span>
              <span
                className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
                style={{ borderColor: process.stage.color ?? "#999", color: process.stage.color ?? undefined }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: process.stage.color ?? "#999" }} />
                {process.stage.name}
              </span>
            </p>
          </div>
          <Avatar name={process.owner.name} src={process.owner.photoUrl} size="sm" />
        </div>

        <div className="mt-4 flex flex-wrap gap-4 text-sm text-neutral-600 dark:text-neutral-300">
          {(process.contact.whatsapp || process.contact.phone) && (
            <span className="inline-flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 text-neutral-400" strokeWidth={2} />
              {process.contact.whatsapp || process.contact.phone}
            </span>
          )}
          {process.contact.email && (
            <span className="inline-flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-neutral-400" strokeWidth={2} />
              {process.contact.email}
            </span>
          )}
          {process.contact.company && (
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-neutral-400" strokeWidth={2} />
              {process.contact.company}
            </span>
          )}
          {address && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-neutral-400" strokeWidth={2} />
              {address}
            </span>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div>
        <div className="card scrollbar-thin flex items-center gap-1 overflow-x-auto p-2">
          {process.pipeline.stages.map((stage) => {
            const isCurrent = stage.id === process.stageId;
            // Só faz sentido calcular pra etapa atual — stageEnteredAt é
            // quando o processo entrou NELA, não teria sentido pras outras.
            const sla = isCurrent ? getStageSlaStatus(stage, new Date(process.stageEnteredAt)) : null;
            return (
              <button
                key={stage.id}
                type="button"
                disabled={!isAdmin}
                onClick={() => moveStage(stage.id)}
                className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-xs whitespace-nowrap transition-colors ${
                  isCurrent
                    ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                    : isAdmin
                      ? "text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-800 dark:hover:text-neutral-200"
                      : "text-neutral-400 dark:text-neutral-600"
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stage.color ?? "#999" }} />
                {stage.name}
                {isCurrent && (
                  <span
                    className={`inline-flex items-center gap-1 ${sla?.overdue ? "text-red-300 dark:text-red-400" : "text-neutral-400 dark:text-neutral-500"}`}
                  >
                    <Clock className="h-3 w-3" strokeWidth={2} />
                    {daysSince(process.stageEnteredAt)}d
                    {sla && ` de ${sla.slaBusinessDays}d úteis`}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {moveError && <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{moveError}</p>}
        {(() => {
          const currentStage = process.pipeline.stages.find((s) => s.id === process.stageId);
          const sla = currentStage ? getStageSlaStatus(currentStage, new Date(process.stageEnteredAt)) : null;
          return sla?.overdue ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
              <Clock className="h-3.5 w-3.5" strokeWidth={2} />
              {sla.daysOverdue} {sla.daysOverdue > 1 ? "dias úteis" : "dia útil"} em atraso nesta etapa (prazo: {sla.slaBusinessDays}d úteis)
            </p>
          ) : null;
        })()}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6">
        <div className="space-y-4 lg:col-span-2">
          {/* Anotações do administrativo — NÃO dispara notificação nenhuma
              (ver lib/processes/notify.ts, que só cobre etapa final e
              solicitação); é puramente um registro que o consultor só vê
              quando abre o processo (hasUnreadNote só marca "tem algo novo"
              no card do Kanban, não é push). Mesmo assim fica em 1º lugar e
              com destaque visual permanente (borda/fundo âmbar), não só
              quando tem pendência como as outras seções desta página — é o
              canal mais usado pelo administrativo, mesmo sendo passivo. */}
          <div className="card space-y-3 border-amber-200 bg-amber-50/40 p-5 dark:border-amber-900 dark:bg-amber-500/10">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
                <StickyNote className="h-4 w-4" strokeWidth={2} />
                Anotações do administrativo
              </p>
              {notes && notes.length > 0 && (
                <Badge tone="warning" size="sm">
                  {notes.length}
                </Badge>
              )}
            </div>
            {notes === null ? (
              <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando…</p>
            ) : notes.length === 0 ? (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhuma anotação ainda.</p>
            ) : (
              <div className="space-y-2">
                {notes.map((n) => (
                  <div key={n.id} className="rounded-md border border-amber-200/70 bg-white px-3.5 py-2.5 text-sm dark:border-amber-900/50 dark:bg-neutral-900">
                    <p className="text-neutral-800 dark:text-neutral-200">{n.body}</p>
                    <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                      {n.user.name} · {new Date(n.createdAt).toLocaleString("pt-BR")}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {isAdmin && (
              <form onSubmit={sendNote} className="flex gap-2">
                <input
                  value={newNoteBody}
                  onChange={(e) => setNewNoteBody(e.target.value)}
                  placeholder="Registrar uma anotação sobre este processo…"
                  className="field-input flex-1 py-1.5 text-sm"
                />
                <button type="submit" disabled={sendingNote || !newNoteBody.trim()} className="btn-secondary shrink-0">
                  {sendingNote ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Send className="h-4 w-4" strokeWidth={2} />}
                  Registrar
                </button>
              </form>
            )}
          </div>

          <div
            className={`card space-y-3 p-5 ${
              unresolvedRequests.length > 0 ? "border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-500/10" : ""
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">Solicitações</p>
              {unresolvedRequests.length > 0 && (
                <Badge tone="warning" size="sm">
                  {unresolvedRequests.length} pendente{unresolvedRequests.length > 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            {requests === null ? (
              <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando…</p>
            ) : requests.length === 0 ? (
              <p className="text-sm text-neutral-400 dark:text-neutral-500">Nenhuma solicitação ainda.</p>
            ) : (
              <div className="space-y-1.5">
                {requests.map((r) => (
                  <div
                    key={r.id}
                    className={`flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
                      r.resolvedAt
                        ? "border-neutral-100 bg-white text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-500"
                        : "border-amber-200 bg-amber-50/60 text-amber-800 dark:border-amber-800 dark:bg-amber-500/5 dark:text-amber-300"
                    }`}
                  >
                    <div>
                      <p className="flex items-center gap-1.5">
                        {r.message}
                        {/* targetUserId preenchido = veio do administrativo via "Enviar modelo" (ver
                            process-detail.tsx/schema.prisma) — direção oposta da solicitação de sempre
                            (consultor avisando o administrativo), vale distinguir visualmente. */}
                        {r.targetUserId && (
                          <Badge tone="accent" size="sm">
                            pedido ao consultor
                          </Badge>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs opacity-70">
                        {r.requestedBy.name} · {new Date(r.createdAt).toLocaleString("pt-BR")}
                        {r.resolvedAt && ` · resolvida por ${r.resolvedBy?.name ?? "—"}`}
                      </p>
                    </div>
                    {/* Quem resolve depende da direção: sem alvo (consultor → admin, de sempre) só
                        admin resolve; com alvo (admin → consultor) só quem está vendo o PRÓPRIO
                        processo como não-admin resolve — não-admin só chega a ver processo que já é
                        seu (ver processScopeWhere), então não precisa comparar userId aqui. */}
                    {(isAdmin ? !r.targetUserId : !!r.targetUserId) && !r.resolvedAt && (
                      <button onClick={() => resolveRequest(r.id)} className="icon-btn shrink-0" title="Marcar como resolvida">
                        <CheckCheck className="h-4 w-4" strokeWidth={2} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={sendRequest} className="flex gap-2">
              <input
                value={newRequestMessage}
                onChange={(e) => setNewRequestMessage(e.target.value)}
                placeholder="Avisar o administrativo sobre algo…"
                className="field-input flex-1 py-1.5 text-sm"
              />
              <button type="submit" disabled={sendingRequest || !newRequestMessage.trim()} className="btn-secondary shrink-0">
                {sendingRequest ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Send className="h-4 w-4" strokeWidth={2} />}
                Solicitar
              </button>
            </form>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card space-y-3 p-4 text-sm">
            <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Dados do processo</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="field-label">Cota</label>
                {isAdmin ? (
                  <input
                    value={quotaInput}
                    onChange={(e) => setQuotaInput(e.target.value)}
                    onBlur={() => {
                      if (quotaInput !== (process.quotaNumber ?? "")) updateMarkers({ quotaNumber: quotaInput || null });
                    }}
                    disabled={saving}
                    className="field-input w-full py-1.5 text-sm"
                  />
                ) : (
                  <p className="text-sm text-neutral-600 dark:text-neutral-300">{process.quotaNumber || "—"}</p>
                )}
              </div>
              <div className="space-y-1">
                <label className="field-label">Grupo</label>
                {isAdmin ? (
                  <input
                    value={groupInput}
                    onChange={(e) => setGroupInput(e.target.value)}
                    onBlur={() => {
                      if (groupInput !== (process.groupNumber ?? "")) updateMarkers({ groupNumber: groupInput || null });
                    }}
                    disabled={saving}
                    className="field-input w-full py-1.5 text-sm"
                  />
                ) : (
                  <p className="text-sm text-neutral-600 dark:text-neutral-300">{process.groupNumber || "—"}</p>
                )}
              </div>
            </div>

            <div className="space-y-1 border-t border-neutral-100 pt-3 dark:border-neutral-800">
              <label className="field-label">Documentação</label>
              {isAdmin ? (
                <Select
                  value={process.documentStatus}
                  onChange={(v) => updateMarkers({ documentStatus: v as DocumentStatus })}
                  className="w-full py-1.5 text-sm"
                  options={Object.entries(DOCUMENT_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
                />
              ) : (
                <p className="text-sm text-neutral-600 dark:text-neutral-300">{DOCUMENT_STATUS_LABELS[process.documentStatus]}</p>
              )}
            </div>
          </div>

          <div className="card space-y-3 p-4">
            <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
              <History className="h-3.5 w-3.5" strokeWidth={2} />
              Histórico de etapas
            </p>
            {history === null ? (
              <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando…</p>
            ) : history.length === 0 ? (
              <p className="text-sm text-neutral-400 dark:text-neutral-500">Nenhuma movimentação ainda.</p>
            ) : (
              <div className="space-y-3">
                {history.map((h) => (
                  <div key={h.id} className="relative border-l-2 border-neutral-200 pl-3 dark:border-neutral-800">
                    <span
                      className="absolute top-0.5 -left-[5px] h-2 w-2 rounded-full"
                      style={{ backgroundColor: h.toStage.color ?? "#999" }}
                    />
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      <span className="font-medium text-neutral-700 dark:text-neutral-300">{h.changedBy.name}</span>{" "}
                      {h.fromStage ? `moveu de "${h.fromStage.name}" para` : "criou em"} &quot;{h.toStage.name}&quot;
                    </p>
                    <p className="mt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">
                      {new Date(h.changedAt).toLocaleString("pt-BR")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
