"use client";

import { useRef, useState } from "react";
import { CheckCircle2, FileText, Loader2, Paperclip, Send, Upload, X } from "lucide-react";
import { Modal } from "@/components/modal";
import { formatFileSize } from "@/components/deal-registration/document-preview";
import { REGISTRATION_DOC_MAX_FILES, REGISTRATION_DOC_MAX_SIZE } from "@/lib/deal-registration/rules";

const ACCEPTED = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const EXT_OK = /\.(pdf|png|jpe?g|webp)$/i;

type Item = { key: string; file: File; status: "queued" | "uploading" | "done" | "error"; error?: string };

let counter = 0;
const nextKey = () => `f${++counter}`;

/**
 * Documentos a mais de uma venda JÁ ganha, enviados por vontade do consultor. Os arquivos
 * escolhidos ficam só na tela (dá para tirar um errado) e só vão para o servidor quando a
 * pessoa clica em "Enviar ao administrativo" — aí sobem um a um e o administrativo é avisado
 * uma única vez (tarefa + push). Se algum arquivo falhar, os outros seguem e o que falhou
 * continua na lista para tentar de novo.
 */
export function SendExtraDocumentsPanel({ dealId, onDirtyChange }: { dealId: string; onDirtyChange?: (dirty: boolean) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  // Arquivos que já subiram mas ainda não avisaram o administrativo (o aviso falhou): na próxima tentativa só avisa.
  const unnotified = useRef<string[]>([]);
  const [pendingNotify, setPendingNotify] = useState(0);

  function update(next: Item[]) {
    setItems(next);
    onDirtyChange?.(next.length > 0 || unnotified.current.length > 0);
  }

  function addFiles(list: FileList | File[] | null) {
    if (!list || busy) return;
    setSentCount(0);
    setNotice(null);
    const problems: string[] = [];
    const accepted: Item[] = [];
    for (const file of Array.from(list)) {
      const okType = ACCEPTED.includes(file.type) || EXT_OK.test(file.name);
      if (!okType) problems.push(`${file.name}: use PDF, PNG ou JPG.`);
      else if (file.size > REGISTRATION_DOC_MAX_SIZE) problems.push(`${file.name}: maior que 10 MB.`);
      else accepted.push({ key: nextKey(), file, status: "queued" });
    }
    const room = REGISTRATION_DOC_MAX_FILES - items.length;
    if (accepted.length > room) {
      problems.push(`No máximo ${REGISTRATION_DOC_MAX_FILES} arquivos por vez.`);
      accepted.length = Math.max(0, room);
    }
    if (problems.length) setNotice(problems.join(" "));
    if (accepted.length) update([...items, ...accepted]);
  }

  function remove(key: string) {
    if (busy) return;
    update(items.filter((i) => i.key !== key));
  }

  async function send() {
    if (busy) return;
    const pending = items.filter((i) => i.status !== "done");
    if (pending.length === 0 && unnotified.current.length === 0) return;
    setBusy(true);
    setNotice(null);
    setSentCount(0);

    let working = items;
    const set = (key: string, patch: Partial<Item>) => {
      working = working.map((i) => (i.key === key ? { ...i, ...patch } : i));
      setItems(working);
    };

    for (const item of pending) {
      set(item.key, { status: "uploading", error: undefined });
      try {
        const body = new FormData();
        body.set("file", item.file);
        body.set("kind", "OTHER");
        const res = await fetch(`/api/deals/${dealId}/registration/documents`, { method: "POST", body });
        const json = (await res.json().catch(() => ({}))) as { document?: { id: string }; error?: string };
        if (res.ok && json.document) {
          unnotified.current.push(json.document.id);
          setPendingNotify(unnotified.current.length);
          set(item.key, { status: "done" });
        } else {
          set(item.key, { status: "error", error: json.error ?? "Não foi possível enviar este arquivo." });
        }
      } catch {
        set(item.key, { status: "error", error: "Sem conexão. Tente de novo." });
      }
    }

    if (unnotified.current.length > 0) {
      const ids = [...unnotified.current];
      const res = await fetch(`/api/deals/${dealId}/registration/extra-documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentIds: ids }),
      }).catch(() => null);
      if (res?.ok) {
        unnotified.current = [];
        setPendingNotify(0);
        setSentCount(ids.length);
        working = working.filter((i) => i.status !== "done");
        setItems(working);
      } else {
        const json = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
        setNotice(json.error ?? "Os arquivos foram anexados, mas não conseguimos avisar o administrativo. Clique em Enviar de novo para avisar.");
      }
    }
    setBusy(false);
    onDirtyChange?.(working.length > 0 || unnotified.current.length > 0);
  }

  const failed = items.some((i) => i.status === "error");
  const canSend = !busy && (items.some((i) => i.status !== "done") || pendingNotify > 0);

  return (
    <div className="space-y-3">
      {sentCount > 0 && (
        <div role="status" className="proof-pop flex items-start gap-2.5 rounded-xl border border-emerald-200/80 bg-emerald-50 p-3 dark:border-emerald-500/25 dark:bg-emerald-500/10">
          <CheckCircle2 className="proof-check mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="text-sm">
            <p className="font-semibold text-emerald-800 dark:text-emerald-200">Enviado ao administrativo</p>
            <p className="text-emerald-700/90 dark:text-emerald-300/90">
              {sentCount === 1 ? "1 documento enviado" : `${sentCount} documentos enviados`}. O administrativo já foi avisado.
            </p>
          </div>
        </div>
      )}

      <ul className="space-y-2" aria-live="polite">
        {items.map((item) => (
          <li
            key={item.key}
            className={`proof-file-in flex items-center gap-3 rounded-xl border p-2.5 transition-colors duration-300 ${
              item.status === "error"
                ? "border-red-200 bg-red-50/70 dark:border-red-500/30 dark:bg-red-500/10"
                : item.status === "done"
                  ? "border-emerald-200/70 bg-emerald-50/70 dark:border-emerald-500/20 dark:bg-emerald-500/10"
                  : "border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800/60"
            }`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-neutral-500 shadow-sm dark:bg-neutral-900">
              {item.status === "uploading" ? (
                <Loader2 className="h-4 w-4 animate-spin text-brand" />
              ) : item.status === "done" ? (
                <CheckCircle2 className="proof-check h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{item.file.name}</p>
              <p className={`truncate text-xs ${item.status === "error" ? "text-red-600 dark:text-red-400" : "text-neutral-500 dark:text-neutral-400"}`}>
                {item.status === "error" ? item.error : item.status === "uploading" ? "Enviando…" : item.status === "done" ? "Enviado" : formatFileSize(item.file.size)}
              </p>
            </div>
            {!busy && item.status !== "done" && (
              <button type="button" onClick={() => remove(item.key)} className="rounded p-1 text-neutral-400 transition-colors hover:text-red-600" aria-label={`Tirar ${item.file.name}`}>
                <X className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 text-center transition-[border-color,background-color,transform,box-shadow,padding] duration-300 ease-smooth ${
          items.length ? "py-3" : "py-7"
        } ${dragOver ? "scale-[1.015] border-brand bg-brand-light/40 shadow-md" : "border-neutral-300 hover:border-neutral-400 dark:border-neutral-700 dark:hover:border-neutral-500"} ${busy ? "pointer-events-none opacity-60" : ""}`}
      >
        <Upload className={`h-5 w-5 text-neutral-400 transition-transform duration-300 ease-smooth ${dragOver ? "-translate-y-1 scale-125 text-brand" : ""}`} />
        <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{items.length ? "Adicionar outro arquivo" : "Arraste os arquivos aqui ou clique para escolher"}</span>
        {!items.length && <span className="text-xs text-neutral-500 dark:text-neutral-400">PDF, PNG ou JPG, até 10 MB cada.</span>}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          multiple
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      {notice && <p className="text-sm text-red-600 dark:text-red-400">{notice}</p>}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">Assim que você enviar, o administrativo é avisado.</p>
        <button type="button" onClick={() => void send()} disabled={!canSend} className="btn-primary shrink-0">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {busy ? "Enviando…" : failed ? "Tentar de novo" : "Enviar ao administrativo"}
        </button>
      </div>
    </div>
  );
}

/** Janela para enviar documentos a mais de um cliente (usada na lista de Clientes). */
export function SendExtraDocumentsDialog({ dealId, clientName, onClose }: { dealId: string; clientName: string; onClose: () => void }) {
  const [dirty, setDirty] = useState(false);

  function close() {
    if (dirty && !window.confirm("Você escolheu arquivos que ainda não foram enviados ao administrativo. Fechar mesmo assim?")) return;
    onClose();
  }

  return (
    <Modal onClose={close} maxWidth="max-w-lg">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-light text-brand dark:bg-[var(--brand-subtle)]">
            <Paperclip className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Enviar documentos</h2>
            <p className="truncate text-sm text-neutral-500 dark:text-neutral-400">{clientName}</p>
          </div>
        </div>
        <button type="button" onClick={close} className="rounded p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200" aria-label="Fechar">
          <X className="h-5 w-5" />
        </button>
      </div>
      <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">Anexe o que mais o administrativo possa precisar deste cliente. Eles recebem o aviso assim que você enviar.</p>
      <SendExtraDocumentsPanel dealId={dealId} onDirtyChange={setDirty} />
    </Modal>
  );
}
