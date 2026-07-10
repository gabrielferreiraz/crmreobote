"use client";

import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  Send,
  Paperclip,
  Image as ImageIcon,
  Mic,
  User,
  QrCode,
  MousePointerClick,
  List,
  X,
  MessageCircle,
} from "lucide-react";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { Modal } from "@/components/modal";
import { CurrencyInput } from "@/components/currency-input";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency } from "@/lib/format";

type MessageType = "TEXT" | "IMAGE" | "AUDIO" | "CONTACT" | "PIX" | "BUTTONS" | "LIST";

type MessageMetadata = {
  name?: string;
  phone?: string;
  amount?: number;
  key?: string;
  buttons?: { label: string }[];
  items?: { title: string; description?: string }[];
};

type Message = {
  id: string;
  direction: "OUTBOUND" | "INBOUND";
  type?: MessageType;
  body: string | null;
  mediaUrl?: string | null;
  metadata?: MessageMetadata | null;
  status: string;
  createdAt: string;
};

type AttachMode = "IMAGE" | "AUDIO" | "CONTACT" | "PIX" | "BUTTONS" | "LIST";

const ATTACH_OPTIONS: { mode: AttachMode; label: string; icon: typeof ImageIcon }[] = [
  { mode: "IMAGE", label: "Imagem", icon: ImageIcon },
  { mode: "AUDIO", label: "Áudio", icon: Mic },
  { mode: "CONTACT", label: "Contato", icon: User },
  { mode: "PIX", label: "Pix", icon: QrCode },
  { mode: "BUTTONS", label: "Botões", icon: MousePointerClick },
  { mode: "LIST", label: "Lista", icon: List },
];

/**
 * Aparece pra todo contato, com ou sem conversa iniciada. O botão só abre o
 * modal — a caixa de envio (com texto e os tipos avançados) fica lá dentro,
 * disponível mesmo sem nenhuma automação ter disparado antes.
 */
export function WhatsAppChat({
  contactId,
  contactName,
  contactPhone,
}: {
  contactId: string;
  contactName?: string;
  contactPhone?: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary w-full justify-center">
        <WhatsAppIcon className="h-4 w-4" strokeWidth={2} />
        Abrir conversa
      </button>
      {open && (
        <WhatsAppChatModal
          contactId={contactId}
          contactName={contactName}
          contactPhone={contactPhone}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function WhatsAppChatModal({
  contactId,
  contactName,
  contactPhone,
  onClose,
}: {
  contactId: string;
  contactName?: string;
  contactPhone?: string | null;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [attachMode, setAttachMode] = useState<AttachMode | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const res = await fetch(`/api/whatsapp/messages/${contactId}`);
      if (res.ok) setMessages(await res.json());
    } catch {
      // Silencioso: se a conversa não carregar, o componente simplesmente não aparece.
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);

  async function sendPayload(payload: Record<string, unknown>) {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp/messages/${contactId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Erro ao enviar mensagem");
        return false;
      }
      await load();
      return true;
    } catch {
      setError("Falha de conexão ao enviar mensagem.");
      return false;
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-2xl">
      <div className="flex h-[75vh] max-h-[42rem] min-h-[28rem] flex-col">
        <div className="mb-3 flex shrink-0 items-center justify-between border-b border-neutral-200/60 pb-3 dark:border-neutral-800/60">
          <div className="flex items-center gap-2.5">
            <Avatar name={contactName ?? "?"} size="md" />
            <div>
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {contactName ?? "Conversa"}
                <WhatsAppIcon className="h-3.5 w-3.5 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{contactPhone || "WhatsApp"}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Fechar">
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto rounded-lg bg-neutral-50 p-3 dark:bg-neutral-950/50">
          {!messages ? (
            <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando…</p>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                icon={MessageCircle}
                title="Nenhuma mensagem ainda"
                description="Envie a primeira mensagem, uma imagem, um Pix ou outro tipo de conteúdo abaixo."
              />
            </div>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}
          <div ref={bottomRef} />
        </div>

        {error && <p className="mt-1 shrink-0 text-xs text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-3 shrink-0 border-t border-neutral-200/60 pt-3 dark:border-neutral-800/60">
          {attachMode === null ? (
            <TextComposer
              sending={sending}
              onSend={(text) => sendPayload({ type: "TEXT", text })}
              menuOpen={attachMenuOpen}
              onToggleMenu={() => setAttachMenuOpen((v) => !v)}
              onPick={(mode) => {
                setAttachMode(mode);
                setAttachMenuOpen(false);
              }}
            />
          ) : (
            <StructuredComposer
              mode={attachMode}
              sending={sending}
              onCancel={() => setAttachMode(null)}
              onSend={async (payload) => {
                const ok = await sendPayload(payload);
                if (ok) setAttachMode(null);
              }}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isOut = message.direction === "OUTBOUND";
  return (
    <div className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-1.5 text-sm ${
          isOut
            ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
            : "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
        }`}
      >
        <MessageContent message={message} />
        <p className="mt-0.5 text-[10px] opacity-60">{new Date(message.createdAt).toLocaleString("pt-BR")}</p>
      </div>
    </div>
  );
}

function MessageContent({ message }: { message: Message }) {
  switch (message.type ?? "TEXT") {
    case "IMAGE":
      return (
        <div className="space-y-1">
          {message.mediaUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={message.mediaUrl} alt="" className="max-h-48 w-full rounded-md object-cover" />
          )}
          {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
        </div>
      );
    case "AUDIO":
      return <audio controls src={message.mediaUrl ?? undefined} className="h-8 w-56 max-w-full" />;
    case "CONTACT":
      return (
        <div className="flex items-center gap-2 rounded-md bg-black/5 px-2 py-1.5 dark:bg-white/10">
          <User className="h-4 w-4 shrink-0 opacity-70" strokeWidth={2} />
          <div className="min-w-0">
            <p className="truncate font-medium">{message.metadata?.name ?? "Contato"}</p>
            <p className="truncate text-xs opacity-70">{message.metadata?.phone ?? ""}</p>
          </div>
        </div>
      );
    case "PIX":
      return (
        <div className="space-y-1 rounded-md bg-black/5 px-2.5 py-2 dark:bg-white/10">
          <p className="flex items-center gap-1.5 text-xs font-medium opacity-80">
            <QrCode className="h-3.5 w-3.5" strokeWidth={2} />
            Cobrança Pix
          </p>
          <p className="text-base font-semibold">
            {message.metadata?.amount != null ? formatCurrency(message.metadata.amount) : "—"}
          </p>
          {message.metadata?.key && <p className="truncate text-xs opacity-70">Chave: {message.metadata.key}</p>}
        </div>
      );
    case "BUTTONS":
      return (
        <div className="space-y-1.5">
          {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
          <div className="space-y-1">
            {(message.metadata?.buttons ?? []).map((b, i) => (
              <div
                key={i}
                className="rounded-md border border-current/20 px-2.5 py-1 text-center text-xs font-medium opacity-90"
              >
                {b.label}
              </div>
            ))}
          </div>
        </div>
      );
    case "LIST":
      return (
        <div className="space-y-1.5">
          {message.body && <p className="font-medium whitespace-pre-wrap">{message.body}</p>}
          <div className="space-y-1 rounded-md border border-current/20 p-1.5">
            {(message.metadata?.items ?? []).map((item, i) => (
              <div key={i} className="px-1.5 py-1 text-xs">
                <p className="font-medium">{item.title}</p>
                {item.description && <p className="opacity-70">{item.description}</p>}
              </div>
            ))}
          </div>
        </div>
      );
    default:
      return <p className="whitespace-pre-wrap">{message.body ?? "—"}</p>;
  }
}

function TextComposer({
  sending,
  onSend,
  menuOpen,
  onToggleMenu,
  onPick,
}: {
  sending: boolean;
  onSend: (text: string) => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onPick: (mode: AttachMode) => void;
}) {
  const [text, setText] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text.trim());
    setText("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <div className="relative">
        <button type="button" onClick={onToggleMenu} className="icon-btn" aria-label="Anexar">
          <Paperclip className="h-4 w-4" strokeWidth={2} />
        </button>
        {menuOpen && (
          <div className="surface-glass absolute bottom-full left-0 z-30 mb-2 w-40 rounded-md p-1 shadow-lg">
            {ATTACH_OPTIONS.map((opt) => (
              <button
                key={opt.mode}
                type="button"
                onClick={() => onPick(opt.mode)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <opt.icon className="h-3.5 w-3.5 opacity-60" strokeWidth={2} />
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Digite uma mensagem…"
        className="field-input flex-1 text-sm"
      />
      <button type="submit" disabled={sending || !text.trim()} className="btn-primary shrink-0">
        {sending ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Send className="h-4 w-4" strokeWidth={2} />}
      </button>
    </form>
  );
}

function StructuredComposer({
  mode,
  sending,
  onCancel,
  onSend,
}: {
  mode: AttachMode;
  sending: boolean;
  onCancel: () => void;
  onSend: (payload: Record<string, unknown>) => void;
}) {
  const option = ATTACH_OPTIONS.find((o) => o.mode === mode)!;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          <option.icon className="h-3.5 w-3.5" strokeWidth={2} />
          {option.label}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          Cancelar
        </button>
      </div>
      {mode === "IMAGE" && <ImageForm sending={sending} onSend={onSend} />}
      {mode === "AUDIO" && <AudioForm sending={sending} onSend={onSend} />}
      {mode === "CONTACT" && <ContactForm sending={sending} onSend={onSend} />}
      {mode === "PIX" && <PixForm sending={sending} onSend={onSend} />}
      {mode === "BUTTONS" && <ButtonsForm sending={sending} onSend={onSend} />}
      {mode === "LIST" && <ListForm sending={sending} onSend={onSend} />}
    </div>
  );
}

function ImageForm({ sending, onSend }: { sending: boolean; onSend: (payload: Record<string, unknown>) => void }) {
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  return (
    <div className="space-y-2">
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Link da imagem" className="field-input text-sm" />
      <input
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        placeholder="Legenda (opcional)"
        className="field-input text-sm"
      />
      <button
        type="button"
        disabled={sending || !url.trim()}
        onClick={() =>
          onSend({
            type: "IMAGE",
            mediaUrl: url.trim(),
            body: caption.trim() || undefined,
            text: caption.trim() || "📷 Imagem",
          })
        }
        className="btn-primary btn-sm w-full justify-center"
      >
        Enviar imagem
      </button>
    </div>
  );
}

function AudioForm({ sending, onSend }: { sending: boolean; onSend: (payload: Record<string, unknown>) => void }) {
  const [url, setUrl] = useState("");
  return (
    <div className="space-y-2">
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Link do áudio" className="field-input text-sm" />
      <button
        type="button"
        disabled={sending || !url.trim()}
        onClick={() => onSend({ type: "AUDIO", mediaUrl: url.trim(), text: "🎵 Áudio" })}
        className="btn-primary btn-sm w-full justify-center"
      >
        Enviar áudio
      </button>
    </div>
  );
}

function ContactForm({ sending, onSend }: { sending: boolean; onSend: (payload: Record<string, unknown>) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  return (
    <div className="space-y-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome" className="field-input text-sm" />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefone" className="field-input text-sm" />
      <button
        type="button"
        disabled={sending || !name.trim() || !phone.trim()}
        onClick={() =>
          onSend({
            type: "CONTACT",
            metadata: { name: name.trim(), phone: phone.trim() },
            text: `👤 ${name.trim()} — ${phone.trim()}`,
          })
        }
        className="btn-primary btn-sm w-full justify-center"
      >
        Enviar contato
      </button>
    </div>
  );
}

function PixForm({ sending, onSend }: { sending: boolean; onSend: (payload: Record<string, unknown>) => void }) {
  const [amount, setAmount] = useState("");
  const [key, setKey] = useState("");
  return (
    <div className="space-y-2">
      <CurrencyInput value={amount} onChange={setAmount} />
      <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Chave Pix" className="field-input text-sm" />
      <button
        type="button"
        disabled={sending || !amount || !key.trim()}
        onClick={() =>
          onSend({
            type: "PIX",
            metadata: { amount: Number(amount), key: key.trim() },
            text: `💰 Cobrança Pix: ${formatCurrency(Number(amount))} — chave ${key.trim()}`,
          })
        }
        className="btn-primary btn-sm w-full justify-center"
      >
        Enviar cobrança Pix
      </button>
    </div>
  );
}

function ButtonsForm({ sending, onSend }: { sending: boolean; onSend: (payload: Record<string, unknown>) => void }) {
  const [body, setBody] = useState("");
  const [buttons, setButtons] = useState(["", "", ""]);

  function updateButton(i: number, value: string) {
    setButtons((prev) => prev.map((b, idx) => (idx === i ? value : b)));
  }

  const filledButtons = buttons.map((b) => b.trim()).filter(Boolean);

  return (
    <div className="space-y-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Texto da mensagem"
        rows={2}
        className="field-input text-sm"
      />
      {buttons.map((b, i) => (
        <input
          key={i}
          value={b}
          onChange={(e) => updateButton(i, e.target.value)}
          placeholder={`Botão ${i + 1}${i > 0 ? " (opcional)" : ""}`}
          className="field-input text-sm"
        />
      ))}
      <button
        type="button"
        disabled={sending || !body.trim() || filledButtons.length === 0}
        onClick={() =>
          onSend({
            type: "BUTTONS",
            text: body.trim(),
            metadata: { buttons: filledButtons.map((label) => ({ label })) },
          })
        }
        className="btn-primary btn-sm w-full justify-center"
      >
        Enviar com botões
      </button>
    </div>
  );
}

function ListForm({ sending, onSend }: { sending: boolean; onSend: (payload: Record<string, unknown>) => void }) {
  const [title, setTitle] = useState("");
  const [items, setItems] = useState([{ title: "", description: "" }]);

  function updateItem(i: number, field: "title" | "description", value: string) {
    setItems((prev) => prev.map((item, idx) => (idx === i ? { ...item, [field]: value } : item)));
  }

  function addItem() {
    setItems((prev) => [...prev, { title: "", description: "" }]);
  }

  function removeItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  const filledItems = items.filter((item) => item.title.trim());

  return (
    <div className="space-y-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Título da lista"
        className="field-input text-sm"
      />
      <div className="scrollbar-thin max-h-32 space-y-2 overflow-y-auto pr-1">
        {items.map((item, i) => (
          <div key={i} className="flex gap-1.5">
            <div className="flex-1 space-y-1">
              <input
                value={item.title}
                onChange={(e) => updateItem(i, "title", e.target.value)}
                placeholder={`Item ${i + 1}`}
                className="field-input text-sm"
              />
              <input
                value={item.description}
                onChange={(e) => updateItem(i, "description", e.target.value)}
                placeholder="Descrição (opcional)"
                className="field-input text-sm"
              />
            </div>
            {items.length > 1 && (
              <button
                type="button"
                onClick={() => removeItem(i)}
                className="icon-btn mt-0.5 shrink-0"
                aria-label="Remover item"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            )}
          </div>
        ))}
      </div>
      <button type="button" onClick={addItem} className="btn-ghost btn-sm w-full justify-center">
        + Adicionar item
      </button>
      <button
        type="button"
        disabled={sending || !title.trim() || filledItems.length === 0}
        onClick={() =>
          onSend({
            type: "LIST",
            text: title.trim(),
            metadata: {
              items: filledItems.map((item) => ({
                title: item.title.trim(),
                description: item.description.trim() || undefined,
              })),
            },
          })
        }
        className="btn-primary btn-sm w-full justify-center"
      >
        Enviar lista
      </button>
    </div>
  );
}
