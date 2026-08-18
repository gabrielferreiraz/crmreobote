"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, Send, Plus, Pencil, Trash2, MessageCircle, User, Check } from "lucide-react";
import { Modal } from "@/components/modal";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { VariablePills, type VariablePillOption } from "@/components/variable-pills";
import { interpolateAutomationTemplate } from "@/lib/automations/variables";

// Mesma sintaxe {{token}} de lib/automations/variables.ts (o que
// interpolate() abaixo entende de verdade) — igual ao que o editor de
// Scripts faz com o próprio conjunto de variáveis (ver components/
// variable-pills.tsx), só que aqui o campo é uma <textarea> comum, então
// clicar insere o texto cru na posição do cursor (ver insertVariable).
const PROCESS_TEMPLATE_VARIABLES: VariablePillOption[] = [
  { token: "{{cliente.nome}}", label: "Nome do cliente" },
  { token: "{{responsavel.nome}}", label: "Nome do consultor" },
  { token: "{{negocio.nome}}", label: "Nome do negócio" },
];

type RankedTemplate = {
  id: string;
  name: string;
  message: string;
  alreadyUsedForProcess: boolean;
  usageCountInStage: number;
};

type ProcessInfo = {
  id: string;
  contact: { id: string; name: string; whatsapp: string | null; phone: string | null };
  owner: { id: string; name: string };
  deal: { name: string };
};

type Target = "CONSULTANT" | "LEAD";

/**
 * "Enviar modelo" — pedir documentação/petição pro consultor ou direto pro
 * cliente, usando um modelo salvo (ver ProcessTemplate). Lista já vem
 * ordenada pelo servidor (mais usado nesta etapa primeiro, já usado neste
 * processo por último — ver lib/processes/templates.ts), então esta tela
 * só precisa renderizar na ordem que chega, sem reordenar nada aqui.
 */
export function SendTemplateDialog({
  process,
  onClose,
  onSent,
}: {
  process: ProcessInfo;
  onClose: () => void;
  onSent: () => void;
}) {
  const [templates, setTemplates] = useState<RankedTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "compose" | "create">("list");
  const [editingId, setEditingId] = useState<string | null>(null);

  const [selected, setSelected] = useState<RankedTemplate | null>(null);
  const [composedMessage, setComposedMessage] = useState("");
  const [target, setTarget] = useState<Target>("CONSULTANT");

  const [newName, setNewName] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const newMessageRef = useRef<HTMLTextAreaElement>(null);

  const [editName, setEditName] = useState("");
  const [editMessage, setEditMessage] = useState("");
  const editMessageRef = useRef<HTMLTextAreaElement>(null);

  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const canUseLead = !!(process.contact.whatsapp || process.contact.phone);

  /**
   * Insere `token` na posição do cursor de uma <textarea> comum (não
   * contentEditable — o modelo em si é texto puro, diferente do editor de
   * Scripts) — mesmo espírito do "Adicionar variável" de lá, versão mais
   * simples pro campo mais simples. onMouseDown com preventDefault nos
   * botões da pílula (ver VariablePills) já garante que o cursor lembrado
   * (selectionStart/End) ainda é válido quando este código roda.
   */
  function insertVariable(ref: React.RefObject<HTMLTextAreaElement | null>, setValue: (v: string) => void, token: string) {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + token + el.value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function loadTemplates() {
    setLoadError(null);
    fetch(`/api/process-templates?processId=${process.id}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setLoadError(data.error ?? "Erro ao carregar modelos");
          return;
        }
        setTemplates(data);
      })
      .catch(() => setLoadError("Falha de conexão."));
  }

  useEffect(loadTemplates, [process.id]);

  function interpolate(text: string): string {
    return interpolateAutomationTemplate(text, {
      "cliente.nome": process.contact.name,
      "responsavel.nome": process.owner.name,
      "negocio.nome": process.deal.name,
    });
  }

  function selectTemplate(t: RankedTemplate) {
    setSelected(t);
    setComposedMessage(interpolate(t.message));
    setTarget(canUseLead ? target : "CONSULTANT");
    setSendError(null);
    setView("compose");
  }

  async function createTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newMessage.trim()) return;
    setBusy(true);
    setSendError(null);
    const res = await fetch("/api/process-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), message: newMessage.trim() }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSendError(data.error ?? "Erro ao criar modelo");
      return;
    }
    setNewName("");
    setNewMessage("");
    const created: RankedTemplate = { ...data, alreadyUsedForProcess: false, usageCountInStage: 0 };
    setTemplates((prev) => [created, ...(prev ?? [])]);
    selectTemplate(created);
  }

  function startEdit(t: RankedTemplate) {
    setEditingId(t.id);
    setEditName(t.name);
    setEditMessage(t.message);
  }

  async function saveEdit(id: string) {
    if (!editName.trim() || !editMessage.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/process-templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim(), message: editMessage.trim() }),
    });
    setBusy(false);
    if (!res.ok) return;
    const updated = await res.json();
    setTemplates((prev) => (prev ?? []).map((t) => (t.id === id ? { ...t, name: updated.name, message: updated.message } : t)));
    setEditingId(null);
  }

  async function deleteTemplate(id: string) {
    setBusy(true);
    const res = await fetch(`/api/process-templates/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return;
    setTemplates((prev) => (prev ?? []).filter((t) => t.id !== id));
  }

  async function send() {
    if (!selected || !composedMessage.trim()) return;
    setBusy(true);
    setSendError(null);
    const res = await fetch(`/api/processes/${process.id}/send-template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: selected.id, target, message: composedMessage.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setSendError(data.error ?? "Erro ao enviar");
      return;
    }
    onSent();
    onClose();
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-lg">
      {view === "list" && (
        <>
          <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Enviar modelo</h2>
          <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
            Peça um documento ou petição pro consultor ou direto pro cliente, usando um modelo salvo.
          </p>

          {loadError ? (
            <p className="py-6 text-center text-sm text-red-600 dark:text-red-400">{loadError}</p>
          ) : templates === null ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-400 dark:text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
              Carregando…
            </div>
          ) : templates.length === 0 ? (
            <div className="py-4">
              <EmptyState
                icon={MessageCircle}
                title="Nenhum modelo criado ainda"
                description="Crie o primeiro modelo abaixo — fica salvo pra usar em qualquer processo depois."
              />
            </div>
          ) : (
            <div className="scrollbar-thin max-h-80 space-y-1.5 overflow-y-auto">
              {templates.map((t) =>
                editingId === t.id ? (
                  <div key={t.id} className="space-y-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} className="field-input w-full py-1.5 text-sm" />
                    <textarea
                      ref={editMessageRef}
                      value={editMessage}
                      onChange={(e) => setEditMessage(e.target.value)}
                      rows={3}
                      className="field-input w-full resize-none py-1.5 text-sm"
                    />
                    <VariablePills
                      variables={PROCESS_TEMPLATE_VARIABLES}
                      onInsert={(token) => insertVariable(editMessageRef, setEditMessage, token)}
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditingId(null)} className="btn-ghost btn-sm">
                        Cancelar
                      </button>
                      <button onClick={() => saveEdit(t.id)} disabled={busy} className="btn-secondary btn-sm">
                        Salvar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    key={t.id}
                    className="group flex items-start gap-2 rounded-md border border-neutral-200 p-3 text-sm transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50"
                  >
                    <button type="button" onClick={() => selectTemplate(t)} className="min-w-0 flex-1 text-left">
                      <p className="flex items-center gap-1.5 font-medium text-neutral-900 dark:text-neutral-100">
                        {t.name}
                        {t.alreadyUsedForProcess && (
                          <Badge tone="neutral" size="sm">
                            já usado aqui
                          </Badge>
                        )}
                      </p>
                      <p className="mt-0.5 truncate text-neutral-500 dark:text-neutral-400">{t.message}</p>
                    </button>
                    <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 coarse:opacity-100">
                      <button onClick={() => startEdit(t)} className="icon-btn h-7 w-7" title="Editar modelo">
                        <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                      <button onClick={() => deleteTemplate(t.id)} className="icon-btn h-7 w-7 hover:text-red-600 dark:hover:text-red-400" title="Apagar modelo">
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                ),
              )}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-2">
            <button onClick={() => setView("create")} className="btn-secondary btn-sm">
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
              Novo modelo
            </button>
            <button onClick={onClose} className="btn-ghost btn-sm">
              Fechar
            </button>
          </div>
        </>
      )}

      {view === "create" && (
        <form onSubmit={createTemplate}>
          <button
            type="button"
            onClick={() => setView("list")}
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            Modelos
          </button>
          <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Novo modelo</h2>
          {sendError && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{sendError}</p>}
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="field-label">Nome</label>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ex.: Solicitar RG e CPF"
                className="field-input w-full"
              />
            </div>
            <div className="space-y-1.5">
              <label className="field-label">Mensagem</label>
              <textarea
                ref={newMessageRef}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                rows={4}
                placeholder="Ex.: Olá {{cliente.nome}}, poderia enviar seu RG e CPF, por favor?"
                className="field-input w-full resize-none"
              />
              <VariablePills
                variables={PROCESS_TEMPLATE_VARIABLES}
                onInsert={(token) => insertVariable(newMessageRef, setNewMessage, token)}
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setView("list")} className="btn-ghost">
              Cancelar
            </button>
            <button type="submit" disabled={busy || !newName.trim() || !newMessage.trim()} className="btn-primary">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Plus className="h-4 w-4" strokeWidth={2.5} />}
              Criar e usar
            </button>
          </div>
        </form>
      )}

      {view === "compose" && selected && (
        <>
          <button
            type="button"
            onClick={() => setView("list")}
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            Modelos
          </button>
          <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{selected.name}</h2>
          {sendError && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{sendError}</p>}

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="field-label">Pra quem</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTarget("CONSULTANT")}
                  className={`flex flex-1 items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    target === "CONSULTANT"
                      ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                      : "border-neutral-300 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  }`}
                >
                  <User className="h-4 w-4 shrink-0" strokeWidth={2} />
                  <span className="min-w-0 truncate">Consultor ({process.owner.name})</span>
                  {target === "CONSULTANT" && <Check className="ml-auto h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />}
                </button>
                <button
                  type="button"
                  disabled={!canUseLead}
                  onClick={() => setTarget("LEAD")}
                  title={canUseLead ? undefined : "Cliente sem telefone/WhatsApp cadastrado"}
                  className={`flex flex-1 items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    target === "LEAD"
                      ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                      : "border-neutral-300 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  }`}
                >
                  <MessageCircle className="h-4 w-4 shrink-0" strokeWidth={2} />
                  <span className="min-w-0 truncate">Cliente ({process.contact.name}, WhatsApp)</span>
                  {target === "LEAD" && <Check className="ml-auto h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />}
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="field-label">Mensagem</label>
              <textarea
                value={composedMessage}
                onChange={(e) => setComposedMessage(e.target.value)}
                rows={5}
                className="field-input w-full resize-none"
              />
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                {target === "CONSULTANT"
                  ? "Vira uma solicitação pendente pro consultor, com aviso na hora."
                  : "Enviado direto pelo WhatsApp do consultor responsável."}
              </p>
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setView("list")} className="btn-ghost">
              Cancelar
            </button>
            <button onClick={send} disabled={busy || !composedMessage.trim()} className="btn-primary">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Send className="h-4 w-4" strokeWidth={2} />}
              Enviar
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
