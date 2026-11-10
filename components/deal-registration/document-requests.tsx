"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  Circle,
  Eye,
  Loader2,
  MessageSquareText,
  Paperclip,
  Send,
  X,
} from "lucide-react";
import { Select } from "@/components/select";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/deal-registration/rules";
import {
  REQUEST_CATALOG,
  REQUEST_LABEL_MAX,
  REQUEST_MESSAGE_MAX,
  REQUEST_NOTE_MAX,
  countRequestPending,
  type RequestItem,
} from "@/lib/deal-registration/request-rules";
import type { DocumentRequestDTO } from "@/lib/deal-registration/requests";

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Campo_Grande",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? fallback;
}

/* ─────────────────────────── Administrativo: pedir ─────────────────────────── */

/**
 * Formulário do administrativo para pedir algo ao consultor. Itens prontos com
 * um clique (o consultor recebe um campo de envio para cada um), item livre e
 * uma mensagem opcional. Para recomeçar já com itens marcados, troque a `key`.
 */
export function RequestComposer({
  dealId,
  consultantName,
  initialKeys = [],
  onCreated,
}: {
  dealId: string;
  consultantName: string;
  initialKeys?: string[];
  onCreated: (request: DocumentRequestDTO) => void;
}) {
  const initialPresetKeys = initialKeys.filter((key) => REQUEST_CATALOG.some((item) => item.key === key));
  const initialMessage = initialPresetKeys
    .map((key) => REQUEST_CATALOG.find((item) => item.key === key)?.label)
    .filter((label): label is string => Boolean(label))
    .join("; ");
  const [presetKeys, setPresetKeys] = useState(initialPresetKeys);
  const [message, setMessage] = useState(initialMessage);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const requestText = message.trim();
    if (!requestText || sending) return;
    setSending(true);
    setError(null);
    try {
      const items = presetKeys.length
        ? presetKeys.map((key) => ({ key }))
        : [{ key: `custom:${Date.now().toString(36)}`, label: requestText.slice(0, REQUEST_LABEL_MAX) }];
      const res = await fetch(`/api/deals/${dealId}/document-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          message: presetKeys.length || requestText.length > REQUEST_LABEL_MAX ? requestText : null,
        }),
      });
      if (!res.ok) {
        setError(await readError(res, "Não foi possível enviar o pedido."));
        return;
      }
      const data = (await res.json()) as { request: DocumentRequestDTO };
      setPresetKeys([]);
      setMessage("");
      onCreated(data.request);
    } catch {
      setError("Sem conexão. Tente de novo.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="field-label" htmlFor={`req-msg-${dealId}`}>
          O que precisa ser enviado ou corrigido?
        </label>
        <textarea
          id={`req-msg-${dealId}`}
          className="field-input min-h-28 resize-y"
          value={message}
          maxLength={REQUEST_MESSAGE_MAX}
          placeholder="Ex.: envie a CNH completa, frente e verso."
          onChange={(e) => {
            setMessage(e.target.value);
            setError(null);
          }}
        />
      </div>

      {error && (
        <p className="flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      <button type="button" onClick={() => void send()} disabled={!message.trim() || sending} className="btn-primary w-full justify-center">
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Enviar para {consultantName.split(" ")[0]}
      </button>
      <p className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">O consultor recebe a solicitação no celular e responde pelo próprio cadastro.</p>
    </div>
  );
}

/* ─────────────────────────── Administrativo: histórico ─────────────────────────── */

function ItemLine({ item, docs, onView }: { item: RequestItem; docs: { id: string; fileName: string }[]; onView?: (docId: string) => void }) {
  const files = item.documentIds.map((id) => docs.find((d) => d.id === id)).filter((d): d is { id: string; fileName: string } => Boolean(d));
  return (
    <li className="flex items-start gap-2 text-sm">
      {item.doneAt ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-neutral-300 dark:text-neutral-600" />
      )}
      <div className="min-w-0 flex-1">
        <p className={item.doneAt ? "text-neutral-500 line-through decoration-neutral-300 dark:text-neutral-400" : "font-medium text-neutral-900 dark:text-neutral-100"}>
          {item.label}
        </p>
        {item.doneAt && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            <span>Atendido em {formatWhen(item.doneAt)}</span>
            {onView &&
              files.map((f) => (
                <button key={f.id} type="button" onClick={() => onView(f.id)} className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                  <Eye className="h-3 w-3" /> Ver {files.length > 1 ? f.fileName : "arquivo"}
                </button>
              ))}
            {item.documentIds.length > files.length && <span>(arquivo já apagado do servidor)</span>}
          </div>
        )}
        {item.note && (
          <p className="mt-1 flex items-start gap-1.5 rounded-lg bg-neutral-50 px-2 py-1.5 text-xs text-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-200">
            <MessageSquareText className="mt-0.5 h-3 w-3 shrink-0 text-neutral-400" /> {item.note}
          </p>
        )}
      </div>
    </li>
  );
}

const STATUS_CHIP: Record<DocumentRequestDTO["status"], { label: string; className: string }> = {
  OPEN: { label: "Aguardando consultor", className: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400" },
  FULFILLED: { label: "Atendido", className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400" },
  CANCELLED: { label: "Cancelado", className: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400" },
};

/** Pedidos já feitos naquele negócio, com o andamento de cada item. */
export function RequestHistory({
  dealId,
  requests,
  documents,
  onChange,
  onView,
}: {
  dealId: string;
  requests: DocumentRequestDTO[];
  documents: { id: string; fileName: string }[];
  onChange: (request: DocumentRequestDTO) => void;
  onView: (docId: string) => void;
}) {
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cancel(id: string) {
    setCancelling(id);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/document-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (!res.ok) {
        setError(await readError(res, "Não foi possível cancelar."));
        return;
      }
      onChange(((await res.json()) as { request: DocumentRequestDTO }).request);
    } finally {
      setCancelling(null);
    }
  }

  if (requests.length === 0) return null;
  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {requests.map((r) => {
        const chip = STATUS_CHIP[r.status];
        const pending = countRequestPending(r.items);
        return (
          <article key={r.id} className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-700">
            <header className="flex flex-wrap items-center justify-between gap-2">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${chip.className}`}>
                {chip.label}
                {r.status === "OPEN" && ` · falta${pending === 1 ? "" : "m"} ${pending}`}
              </span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {r.requestedByName.split(" ")[0]} · {formatWhen(r.createdAt)}
              </span>
            </header>
            {r.message && <p className="mt-2 text-sm italic text-neutral-600 dark:text-neutral-300">“{r.message}”</p>}
            <ul className="mt-2 space-y-2">
              {r.items.map((item) => (
                <ItemLine key={item.key} item={item} docs={documents} onView={onView} />
              ))}
            </ul>
            {r.status === "OPEN" && (
              <div className="mt-3 flex justify-end">
                <button type="button" onClick={() => void cancel(r.id)} disabled={cancelling === r.id} className="btn-ghost text-xs">
                  {cancelling === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} Cancelar pedido
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── Consultor: atender ─────────────────────────── */

function RequestItemAction({
  dealId,
  requestId,
  item,
  onResult,
}: {
  dealId: string;
  requestId: string;
  item: RequestItem;
  onResult: (request: DocumentRequestDTO, fulfilled: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  // Pedido "informar grupo, prazo e forma de pagamento": os três campos vão direto para o cadastro.
  const [quota, setQuota] = useState({ groupNumber: "", termMonths: "", paymentMethod: "" });

  async function complete(documentIds: string[] | undefined, text: string | null) {
    const res = await fetch(`/api/deals/${dealId}/document-requests/${requestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "complete_item", itemKey: item.key, documentIds, note: text }),
    });
    if (!res.ok) throw new Error(await readError(res, "Não foi possível registrar."));
    const data = (await res.json()) as { request: DocumentRequestDTO; fulfilled: boolean };
    onResult(data.request, data.fulfilled);
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0 || !item.kind) return;
    setBusy(true);
    setError(null);
    try {
      const ids: string[] = [];
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.append("file", file);
        body.append("kind", item.kind);
        const res = await fetch(`/api/deals/${dealId}/registration/documents`, { method: "POST", body });
        if (!res.ok) throw new Error(await readError(res, "Não foi possível enviar o arquivo."));
        ids.push(((await res.json()) as { document: { id: string } }).document.id);
      }
      await complete(ids, null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function saveQuotaInfo() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/registration`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registration: { groupNumber: quota.groupNumber.trim(), termMonths: Number(quota.termMonths), paymentMethod: quota.paymentMethod },
        }),
      });
      if (!res.ok) throw new Error(await readError(res, "Não foi possível salvar."));
      await complete(undefined, `Grupo ${quota.groupNumber.trim()} · ${quota.termMonths} meses · ${quota.paymentMethod}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function reply() {
    setBusy(true);
    setError(null);
    try {
      await complete(undefined, note.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível responder.");
    } finally {
      setBusy(false);
    }
  }

  if (item.doneAt) {
    return (
      <li className="flex items-center gap-2 rounded-xl bg-emerald-50/70 px-3 py-2.5 text-sm dark:bg-emerald-500/10">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span className="min-w-0 flex-1 text-neutral-700 dark:text-neutral-200">{item.label}</span>
        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Enviado</span>
      </li>
    );
  }

  if (item.key === "quota_info") {
    const ready = quota.groupNumber.trim() && Number(quota.termMonths) > 0 && quota.paymentMethod;
    return (
      <li className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{item.label}</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="field-label">Grupo</label>
            <input className="field-input" inputMode="numeric" value={quota.groupNumber} onChange={(e) => setQuota((q) => ({ ...q, groupNumber: e.target.value.replace(/\D/g, "").slice(0, 8) }))} />
          </div>
          <div className="space-y-1">
            <label className="field-label">Prazo (meses)</label>
            <input className="field-input" inputMode="numeric" value={quota.termMonths} onChange={(e) => setQuota((q) => ({ ...q, termMonths: e.target.value.replace(/\D/g, "").slice(0, 3) }))} />
          </div>
          <div className="space-y-1">
            <label className="field-label">Forma de pagamento</label>
            <Select value={quota.paymentMethod} onChange={(v) => setQuota((q) => ({ ...q, paymentMethod: v }))} options={PAYMENT_METHOD_OPTIONS.map((o) => ({ value: o, label: o }))} placeholder="Escolha" ariaLabel="Forma de pagamento" />
          </div>
        </div>
        <button type="button" onClick={() => void saveQuotaInfo()} disabled={busy || !ready} className="btn-primary btn-sm mt-3">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Salvar e responder
        </button>
        {error && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400" role="alert">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        )}
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-sm font-medium text-neutral-900 dark:text-neutral-100">{item.label}</p>
        {item.needsFile && (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => void onFiles(e.target.files)}
            />
            <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="btn-primary btn-sm">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
              {busy ? "Enviando…" : "Enviar arquivo"}
            </button>
          </>
        )}
      </div>
      {item.needsFile ? (
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Foto ou PDF, até 10 MB cada. Pode escolher mais de um arquivo (ex.: frente e verso).</p>
      ) : (
        <div className="mt-2 space-y-2">
          <textarea
            className="field-input min-h-[64px] resize-y"
            value={note}
            maxLength={REQUEST_NOTE_MAX}
            placeholder="Escreva a resposta para o administrativo"
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="button" onClick={() => void reply()} disabled={busy || !note.trim()} className="btn-primary btn-sm">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Responder
          </button>
        </div>
      )}
      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400" role="alert">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}
    </li>
  );
}

/**
 * Cartão do consultor na página da venda: aparece só enquanto há pedido aberto
 * do administrativo, com um campo de envio para cada item.
 */
export function ConsultantRequests({ dealId }: { dealId: string }) {
  const [requests, setRequests] = useState<DocumentRequestDTO[] | null>(null);
  const [allDone, setAllDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deals/${dealId}/document-requests`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { requests: DocumentRequestDTO[] } | null) => {
        if (!cancelled) setRequests(json?.requests ?? []);
      })
      .catch(() => {
        if (!cancelled) setRequests([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  const open = (requests ?? []).filter((r) => r.status === "OPEN");

  function applyResult(request: DocumentRequestDTO, fulfilled: boolean) {
    setRequests((prev) => (prev ?? []).map((r) => (r.id === request.id ? request : r)));
    if (fulfilled) setAllDone(true);
  }

  if (allDone && open.length === 0) {
    return (
      <section className="card mt-3 flex items-center gap-3 border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/10">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div>
          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Tudo enviado</p>
          <p className="text-xs text-neutral-600 dark:text-neutral-300">O administrativo já foi avisado.</p>
        </div>
      </section>
    );
  }
  if (open.length === 0) return null;

  return (
    <section className="card mt-3 space-y-3 border-amber-300/70 p-4 dark:border-amber-500/30" aria-label="Pedido do administrativo">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
          <BellRing className="h-4 w-4" strokeWidth={2} />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Pedido do administrativo</h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Para concluir o cadastro da cota, falta o que está abaixo.</p>
        </div>
      </div>
      {open.map((r) => (
        <div key={r.id} className="space-y-2">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {r.requestedByName} · {formatWhen(r.createdAt)}
          </p>
          {r.message && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-neutral-800 dark:bg-amber-500/10 dark:text-neutral-100">“{r.message}”</p>}
          <ul className="space-y-2">
            {r.items.map((item) => (
              <RequestItemAction key={item.key} dealId={dealId} requestId={r.id} item={item} onResult={applyResult} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

