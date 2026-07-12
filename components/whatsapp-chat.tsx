"use client";

import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  Send,
  Paperclip,
  Image as ImageIcon,
  ImageOff,
  Mic,
  Square,
  User,
  QrCode,
  X,
  MessageCircle,
  Maximize2,
  Minimize2,
  Bold,
  Italic,
  Strikethrough,
  Reply,
  ArrowLeft,
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
} from "lucide-react";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { Modal } from "@/components/modal";
import { CurrencyInput } from "@/components/currency-input";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency } from "@/lib/format";

/**
 * Fundo tipo "papel de parede" do WhatsApp, mas discreto — uns rabiscos
 * soltos repetindo em mosaico, quase imperceptível atrás das bolhas.
 */
const CHAT_BACKGROUND_PATTERN = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140">
  <g fill="none" stroke="#8a8a8a" stroke-width="1.3" stroke-linecap="round" opacity="0.5">
    <circle cx="16" cy="18" r="2.4" />
    <path d="M46 14c4-6 10-4 9 2s-8 6-9 0" />
    <circle cx="92" cy="24" r="1.8" />
    <path d="M118 46c3 3 3 7 0 10" />
    <path d="M20 62c6-3 10 2 6 7s-10 1-9-4" />
    <circle cx="64" cy="74" r="2.2" />
    <path d="M104 82l6 6m-6 0l6-6" />
    <circle cx="12" cy="110" r="1.8" />
    <path d="M52 116c5-5 11-2 9 4" />
    <circle cx="120" cy="118" r="2.4" />
    <path d="M80 12c2 4-2 7-5 4" />
  </g>
</svg>
`)}`;

type MessageType = "TEXT" | "IMAGE" | "AUDIO" | "CONTACT" | "PIX" | "BUTTONS" | "LIST";

type MessageMetadata = {
  name?: string;
  phone?: string;
  amount?: number;
  key?: string;
  buttons?: { label: string }[];
  items?: { title: string; description?: string }[];
};

type QuotedMessage = { id: string; type?: MessageType; body: string | null; direction: "OUTBOUND" | "INBOUND" };

type Message = {
  id: string;
  direction: "OUTBOUND" | "INBOUND";
  type?: MessageType;
  body: string | null;
  mediaUrl?: string | null;
  metadata?: MessageMetadata | null;
  status: string;
  createdAt: string;
  replyToId?: string | null;
  replyTo?: QuotedMessage | null;
};

const QUOTE_PREVIEW_FALLBACK: Record<string, string> = {
  IMAGE: "📷 Imagem",
  AUDIO: "🎵 Áudio",
  CONTACT: "👤 Contato",
  PIX: "💰 Pix",
};

function previewForQuote(msg: QuotedMessage): string {
  return msg.body || QUOTE_PREVIEW_FALLBACK[msg.type ?? "TEXT"] || "Mensagem";
}

// BUTTONS/LIST não entram mais aqui: confirmado em produção que o WhatsApp
// não entrega/renderiza esse tipo de mensagem fora de conta Business API
// oficial (é o truque não-oficial do Baileys). Mensagens antigas desses
// tipos continuam sendo exibidas no histórico via MessageContent abaixo.
type AttachMode = "IMAGE" | "AUDIO" | "CONTACT" | "PIX";

const ATTACH_OPTIONS: { mode: AttachMode; label: string; icon: typeof ImageIcon }[] = [
  { mode: "IMAGE", label: "Imagem", icon: ImageIcon },
  { mode: "AUDIO", label: "Áudio", icon: Mic },
  { mode: "CONTACT", label: "Contato", icon: User },
  { mode: "PIX", label: "Pix", icon: QrCode },
];

/**
 * Troca de estado (abrir/fechar conversa, entrar/sair do modo foco) usando a
 * View Transitions API nativa do navegador quando disponível — dá um
 * fade/morph suave de graça, sem framer-motion e sem precisar animar
 * `position: fixed` (que não é animável via transition/keyframe comuns).
 * Em navegadores sem suporte, cai de volta pra troca instantânea normal.
 */
export function withViewTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
  if (typeof doc.startViewTransition === "function") {
    doc.startViewTransition(update);
  } else {
    update();
  }
}

/**
 * Sobe o arquivo pro R2 (via app/api/whatsapp/media) e devolve a chave
 * interna — nunca uma URL pública direta, o bucket é privado por padrão.
 */
async function uploadMedia(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/whatsapp/media", { method: "POST", body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Falha ao enviar arquivo");
  return data.key as string;
}

/**
 * Aparece pra todo contato, com ou sem conversa iniciada. O botão só abre o
 * modal — a caixa de envio (com texto e os tipos avançados) fica lá dentro,
 * disponível mesmo sem nenhuma automação ter disparado antes.
 */
export function WhatsAppChat({
  threadId,
  contactName,
  contactPhone,
  currentUserName,
  currentUserPhotoUrl,
}: {
  threadId: string;
  contactName?: string;
  contactPhone?: string | null;
  currentUserName?: string;
  currentUserPhotoUrl?: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => withViewTransition(() => setOpen(true))}
        className="btn-secondary w-full justify-center"
      >
        <WhatsAppIcon className="h-4 w-4" strokeWidth={2} />
        Abrir conversa
      </button>
      {open && (
        <WhatsAppChatModal
          threadId={threadId}
          contactName={contactName}
          contactPhone={contactPhone}
          currentUserName={currentUserName}
          currentUserPhotoUrl={currentUserPhotoUrl}
          onClose={() => withViewTransition(() => setOpen(false))}
        />
      )}
    </>
  );
}

/**
 * Botão que só abre o painel — mantido separado do painel em si porque o
 * painel precisa ficar fora da coluna estreita da barra lateral (como irmão
 * do conteúdo do negócio no layout flex), enquanto o gatilho continua no
 * lugar de sempre. Quem controla o `open` é a página (ver deal-detail.tsx).
 */
export function WhatsAppPanelTrigger({ onOpen, hasUnread }: { onOpen: () => void; hasUnread?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => withViewTransition(onOpen)}
      className="btn-secondary relative w-full justify-center"
    >
      <WhatsAppIcon className="h-4 w-4" strokeWidth={2} />
      Abrir conversa
      {hasUnread && (
        <span className="absolute -top-1 -right-1 flex h-3 w-3" title="O lead respondeu">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600" />
        </span>
      )}
    </button>
  );
}

/**
 * Versão "de lado" do chat — usada na página do negócio, onde faz sentido
 * acompanhar o negócio e a conversa ao mesmo tempo em vez de cobrir a tela
 * com um modal. Renderizar isso já assume que está "aberto"; o controle de
 * quando montar/desmontar é de quem usa (deal-detail.tsx).
 */
export function WhatsAppPanel({
  threadId,
  contactName,
  contactPhone,
  currentUserName,
  currentUserPhotoUrl,
  onClose,
}: {
  threadId: string;
  contactName?: string;
  contactPhone?: string | null;
  currentUserName?: string;
  currentUserPhotoUrl?: string | null;
  onClose: () => void;
}) {
  return (
    <div className="surface-glass sticky top-4 hidden h-[calc(100vh-8rem)] w-[360px] shrink-0 flex-col overflow-hidden rounded-lg p-4 shadow-lg lg:flex">
      <ChatWindow
        threadId={threadId}
        contactName={contactName}
        contactPhone={contactPhone}
        currentUserName={currentUserName}
        currentUserPhotoUrl={currentUserPhotoUrl}
        onClose={() => withViewTransition(onClose)}
        className="h-full"
      />
    </div>
  );
}

function WhatsAppChatModal({
  threadId,
  contactName,
  contactPhone,
  currentUserName,
  currentUserPhotoUrl,
  onClose,
}: {
  threadId: string;
  contactName?: string;
  contactPhone?: string | null;
  currentUserName?: string;
  currentUserPhotoUrl?: string | null;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} maxWidth="max-w-2xl">
      <ChatWindow
        threadId={threadId}
        contactName={contactName}
        contactPhone={contactPhone}
        currentUserName={currentUserName}
        currentUserPhotoUrl={currentUserPhotoUrl}
        onClose={onClose}
        className="h-[75vh] max-h-[42rem] min-h-[28rem]"
      />
    </Modal>
  );
}

export function ChatWindow({
  threadId,
  contactName,
  contactPhone,
  currentUserName,
  currentUserPhotoUrl,
  onClose,
  className = "",
  backMode = false,
}: {
  threadId: string;
  contactName?: string;
  contactPhone?: string | null;
  currentUserName?: string;
  currentUserPhotoUrl?: string | null;
  onClose: () => void;
  className?: string;
  /** No mestre-detalhe do mobile o botão de fechar volta pra lista — troca o X por uma seta. */
  backMode?: boolean;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [attachMode, setAttachMode] = useState<AttachMode | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [pastedImage, setPastedImage] = useState<File | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const res = await fetch(`/api/whatsapp/messages/${threadId}`);
      if (res.ok) setMessages(await res.json());
    } catch {
      // Silencioso: se a conversa não carregar, o componente simplesmente não aparece.
    }
  }

  useEffect(() => {
    load();
    // Sem isso, uma mensagem que chega enquanto o chat está aberto (ou que o
    // webhook processa um instante depois de abrir) só apareceria se a pessoa
    // fechasse e abrisse de novo.
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);

  async function sendPayload(payload: Record<string, unknown>) {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp/messages/${threadId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, replyToId: replyingTo?.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Erro ao enviar mensagem");
        return false;
      }
      setReplyingTo(null);
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
    <div
      className={
        expanded
          ? "fixed inset-0 z-[60] flex min-h-0 flex-col bg-white p-4 dark:bg-neutral-950"
          : `flex min-h-0 flex-col ${className}`
      }
    >
      <div className="mb-3 flex shrink-0 items-center justify-between border-b border-neutral-200/60 pb-3 dark:border-neutral-800/60">
        <div className="flex min-w-0 items-center gap-2.5">
          {backMode && (
            <button type="button" onClick={onClose} className="icon-btn -ml-1 shrink-0" aria-label="Voltar">
              <ArrowLeft className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
          <Avatar name={contactName ?? "?"} size="md" className="shrink-0" />
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {contactName ?? "Conversa"}
              <WhatsAppIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
            </h2>
            <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{contactPhone || "WhatsApp"}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => withViewTransition(() => setExpanded((v) => !v))}
            className="icon-btn"
            aria-label={expanded ? "Sair do modo foco" : "Modo foco"}
            title={expanded ? "Sair do modo foco" : "Modo foco"}
          >
            {expanded ? (
              <Minimize2 className="h-4 w-4" strokeWidth={2} />
            ) : (
              <Maximize2 className="h-4 w-4" strokeWidth={2} />
            )}
          </button>
          {!backMode && (
            <button type="button" onClick={onClose} className="icon-btn" aria-label="Fechar">
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      <div
        className="scrollbar-thin flex-1 space-y-2 overflow-y-auto rounded-lg bg-neutral-50 p-3 dark:bg-neutral-950/50"
        style={{ backgroundImage: `url("${CHAT_BACKGROUND_PATTERN}")`, backgroundRepeat: "repeat" }}
      >
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
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              contactName={contactName}
              currentUserName={currentUserName}
              currentUserPhotoUrl={currentUserPhotoUrl}
              onReply={setReplyingTo}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {error && <p className="mt-1 shrink-0 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {replyingTo && (
        <div className="mt-2 flex shrink-0 items-start gap-2 rounded-md border-l-2 border-neutral-400 bg-neutral-100 px-2.5 py-1.5 dark:border-neutral-600 dark:bg-neutral-800">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
              {replyingTo.direction === "OUTBOUND" ? "Você" : (contactName ?? "Contato")}
            </p>
            <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
              {previewForQuote(replyingTo)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReplyingTo(null)}
            className="icon-btn h-5 w-5 shrink-0"
            aria-label="Cancelar resposta"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        </div>
      )}

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
            onPasteImage={(file) => {
              setPastedImage(file);
              setAttachMode("IMAGE");
            }}
          />
        ) : (
          <StructuredComposer
            mode={attachMode}
            sending={sending}
            initialImageFile={pastedImage}
            onCancel={() => {
              setAttachMode(null);
              setPastedImage(null);
            }}
            onSend={async (payload) => {
              const ok = await sendPayload(payload);
              if (ok) {
                setAttachMode(null);
                setPastedImage(null);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  contactName,
  currentUserName,
  currentUserPhotoUrl,
  onReply,
}: {
  message: Message;
  contactName?: string;
  currentUserName?: string;
  currentUserPhotoUrl?: string | null;
  onReply: (message: Message) => void;
}) {
  const isOut = message.direction === "OUTBOUND";
  const avatar = isOut ? (
    <Avatar name={currentUserName ?? "?"} src={currentUserPhotoUrl} size="xs" className="shrink-0" />
  ) : (
    <Avatar name={contactName ?? "?"} size="xs" className="shrink-0" />
  );
  const replyButton = (
    <button
      type="button"
      onClick={() => onReply(message)}
      className="icon-btn h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 max-lg:opacity-100"
      aria-label="Responder"
      title="Responder"
    >
      <Reply className="h-3.5 w-3.5" strokeWidth={2} />
    </button>
  );

  return (
    <div className={`group flex items-end gap-1.5 ${isOut ? "justify-end" : "justify-start"}`}>
      {!isOut && avatar}
      {isOut && replyButton}
      <div
        className={`max-w-[75%] rounded-2xl px-3 py-1.5 text-sm ${
          isOut
            ? "rounded-br-sm bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
            : "rounded-bl-sm bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
        }`}
      >
        {message.replyTo && (
          <div
            className={`mb-1 rounded-md border-l-2 px-2 py-1 text-xs ${
              isOut
                ? "border-white/40 bg-white/10 dark:border-neutral-900/30 dark:bg-neutral-900/10"
                : "border-neutral-400 bg-black/5 dark:border-neutral-500 dark:bg-white/5"
            }`}
          >
            <p className="truncate opacity-80">{previewForQuote(message.replyTo)}</p>
          </div>
        )}
        <MessageContent message={message} />
        <p className="mt-0.5 flex items-center gap-1 text-[10px] opacity-60">
          {new Date(message.createdAt).toLocaleString("pt-BR")}
          {isOut && <MessageStatusIcon status={message.status} />}
        </p>
      </div>
      {!isOut && replyButton}
      {isOut && avatar}
    </div>
  );
}

/** Espelha o padrão de confirmação de leitura do WhatsApp — só faz sentido pra quem a gente enviou. */
function MessageStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "PENDING":
      return <Clock className="h-3 w-3 shrink-0" strokeWidth={2} />;
    case "SENT":
      return <Check className="h-3 w-3 shrink-0" strokeWidth={2} />;
    case "DELIVERED":
      return <CheckCheck className="h-3 w-3 shrink-0" strokeWidth={2} />;
    case "READ":
      return <CheckCheck className="h-3 w-3 shrink-0 text-sky-400" strokeWidth={2} />;
    case "FAILED":
      return (
        <span title="Falha ao entregar">
          <AlertCircle className="h-3 w-3 shrink-0 text-red-400" strokeWidth={2} />
        </span>
      );
    default:
      return null;
  }
}

/** Miniatura clicável — abre em tela cheia com zoom, do jeito que todo app de chat faz. */
function ImageMessage({ url }: { url: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block w-full overflow-hidden rounded-md">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          className="max-h-48 w-full cursor-zoom-in object-cover transition-opacity active:opacity-80"
        />
      </button>
      {open && <ImageLightbox url={url} onClose={() => setOpen(false)} />}
    </>
  );
}

function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const [zoomed, setZoomed] = useState(false);
  const [origin, setOrigin] = useState("center");

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function toggleZoom(e: React.MouseEvent<HTMLImageElement>) {
    if (!zoomed) {
      const rect = e.currentTarget.getBoundingClientRect();
      setOrigin(`${((e.clientX - rect.left) / rect.width) * 100}% ${((e.clientY - rect.top) / rect.height) * 100}%`);
    }
    setZoomed((v) => !v);
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4"
      style={{ animation: "modal-backdrop-in 150ms ease-out" }}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="icon-btn absolute top-3 right-3 text-white hover:bg-white/10 hover:text-white active:bg-white/10 active:text-white"
        aria-label="Fechar"
      >
        <X className="h-5 w-5" strokeWidth={2} />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        onClick={(e) => {
          e.stopPropagation();
          toggleZoom(e);
        }}
        className={`max-h-full max-w-full rounded-md object-contain transition-transform duration-200 ease-out ${
          zoomed ? "scale-[2.2] cursor-zoom-out" : "cursor-zoom-in"
        }`}
        style={{ transformOrigin: origin }}
      />
    </div>
  );
}

function MessageContent({ message }: { message: Message }) {
  switch (message.type ?? "TEXT") {
    case "IMAGE":
      return (
        <div className="space-y-1">
          {message.mediaUrl ? (
            <ImageMessage url={message.mediaUrl} />
          ) : (
            <p className="flex items-center gap-1.5 text-xs italic opacity-60">
              <ImageOff className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              Imagem expirada
            </p>
          )}
          {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
        </div>
      );
    case "AUDIO":
      return message.mediaUrl ? (
        <audio controls src={message.mediaUrl} className="h-8 w-56 max-w-full" />
      ) : (
        <p className="text-xs italic opacity-60">Áudio expirado</p>
      );
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

const FORMAT_OPTIONS: {
  marker: string;
  label: string;
  icon: typeof Bold;
  shortcutKey: string;
  shortcutLabel: string;
  needsShift?: boolean;
}[] = [
  { marker: "*", label: "Negrito", icon: Bold, shortcutKey: "b", shortcutLabel: "Ctrl+B" },
  { marker: "_", label: "Itálico", icon: Italic, shortcutKey: "i", shortcutLabel: "Ctrl+I" },
  // Ctrl+S sozinho aciona "Salvar página" do navegador — usa Shift pra não brigar com isso.
  { marker: "~", label: "Tachado", icon: Strikethrough, shortcutKey: "s", shortcutLabel: "Ctrl+Shift+S", needsShift: true },
];

const MAX_TEXTAREA_HEIGHT = 120;

function autoResizeTextarea(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
}

/** Ctrl+V de um print/imagem copiada (não texto) — o caso comum de "colei sem salvar no PC antes". */
function getPastedImageFile(e: React.ClipboardEvent): File | null {
  for (const item of e.clipboardData?.items ?? []) {
    if (item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}

function TextComposer({
  sending,
  onSend,
  menuOpen,
  onToggleMenu,
  onPick,
  onPasteImage,
}: {
  sending: boolean;
  onSend: (text: string) => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onPick: (mode: AttachMode) => void;
  onPasteImage: (file: File) => void;
}) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function submit() {
    if (!text.trim()) return;
    onSend(text.trim());
    setText("");
    requestAnimationFrame(() => {
      if (textareaRef.current) autoResizeTextarea(textareaRef.current);
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit();
  }

  function applyFormat(marker: string) {
    const el = textareaRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd, value } = el;
    const selected = value.slice(selectionStart, selectionEnd);
    const next = value.slice(0, selectionStart) + marker + selected + marker + value.slice(selectionEnd);
    setText(next);
    const cursorStart = selectionStart + marker.length;
    const cursorEnd = cursorStart + selected.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursorStart, cursorEnd);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }
    const format = FORMAT_OPTIONS.find(
      (f) =>
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === f.shortcutKey &&
        e.shiftKey === !!f.needsShift,
    );
    if (format) {
      e.preventDefault();
      applyFormat(format.marker);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const file = getPastedImageFile(e);
    if (file) {
      e.preventDefault();
      onPasteImage(file);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-1.5">
      <div className="flex items-center gap-0.5">
        {FORMAT_OPTIONS.map((f) => (
          <button
            key={f.marker}
            type="button"
            onClick={() => applyFormat(f.marker)}
            className="icon-btn h-6 w-6"
            aria-label={f.label}
            title={`${f.label} (${f.shortcutLabel})`}
          >
            <f.icon className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <div className="relative shrink-0">
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
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-neutral-600 transition-colors hover:bg-neutral-100 active:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:active:bg-neutral-800"
                >
                  <opt.icon className="h-3.5 w-3.5 opacity-60" strokeWidth={2} />
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            autoResizeTextarea(e.target);
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Digite uma mensagem… (Shift+Enter para quebrar linha)"
          rows={1}
          className="field-input scrollbar-thin max-h-[120px] flex-1 resize-none py-2 text-sm"
        />
        <button type="submit" disabled={sending || !text.trim()} className="btn-primary shrink-0">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Send className="h-4 w-4" strokeWidth={2} />}
        </button>
      </div>
    </form>
  );
}

function StructuredComposer({
  mode,
  sending,
  initialImageFile,
  onCancel,
  onSend,
}: {
  mode: AttachMode;
  sending: boolean;
  initialImageFile?: File | null;
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
          className="tap-target -m-2 px-2 text-xs text-neutral-400 transition-colors hover:text-neutral-700 active:text-neutral-900 dark:hover:text-neutral-200 dark:active:text-neutral-100"
        >
          Cancelar
        </button>
      </div>
      {mode === "IMAGE" && <ImageForm sending={sending} onSend={onSend} initialFile={initialImageFile} />}
      {mode === "AUDIO" && <AudioForm sending={sending} onSend={onSend} />}
      {mode === "CONTACT" && <ContactForm sending={sending} onSend={onSend} />}
      {mode === "PIX" && <PixForm sending={sending} onSend={onSend} />}
    </div>
  );
}

function ImageForm({
  sending,
  onSend,
  initialFile,
}: {
  sending: boolean;
  onSend: (payload: Record<string, unknown>) => void;
  initialFile?: File | null;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function pickFile(f: File | null) {
    setError(null);
    setFile(f);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return f ? URL.createObjectURL(f) : null;
    });
  }

  // Chega já preenchido quando o usuário colou (Ctrl+V) uma imagem em vez de
  // usar o seletor de arquivo — não precisa mais salvar no PC pra anexar.
  useEffect(() => {
    if (initialFile) pickFile(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function handlePaste(e: React.ClipboardEvent) {
    const pasted = getPastedImageFile(e);
    if (pasted) {
      e.preventDefault();
      pickFile(pasted);
    }
  }

  async function handleSend() {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const key = await uploadMedia(file);
      onSend({
        type: "IMAGE",
        mediaUrl: key,
        body: caption.trim() || undefined,
        text: caption.trim() || "📷 Imagem",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar imagem");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
      />
      {preview ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="" className="max-h-40 w-full rounded-md object-cover" />
          <button
            type="button"
            onClick={() => pickFile(null)}
            className="icon-btn absolute top-1.5 right-1.5 bg-black/50 text-white hover:bg-black/70"
            aria-label="Remover imagem"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="btn-secondary btn-sm w-full justify-center"
        >
          <ImageIcon className="h-4 w-4" strokeWidth={2} />
          Escolher imagem
        </button>
      )}
      <input
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        onPaste={handlePaste}
        placeholder={preview ? "Legenda (opcional)" : "Legenda — ou cole uma imagem aqui (Ctrl+V)"}
        className="field-input text-sm"
      />
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="button"
        disabled={sending || uploading || !file}
        onClick={handleSend}
        className="btn-primary btn-sm w-full justify-center"
      >
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : "Enviar imagem"}
      </button>
    </div>
  );
}

function pickAudioMimeType(): string {
  const candidates = ["audio/webm", "audio/ogg", "audio/mp4"];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
  }
  return "audio/webm";
}

const WAVEFORM_BARS = 24;

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function AudioForm({ sending, onSend }: { sending: boolean; onSend: (payload: Record<string, unknown>) => void }) {
  const [recording, setRecording] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(Array(WAVEFORM_BARS).fill(3));
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  // Se o formulário for fechado/trocado com a gravação ainda rolando, solta o
  // microfone e o AudioContext em vez de deixá-los presos em segundo plano.
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stream.getTracks().forEach((t) => t.stop());
      }
      stopVisualizer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopVisualizer() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }

  async function startRecording() {
    setError(null);
    setElapsed(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickAudioMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const recorded = new Blob(chunksRef.current, { type: mimeType });
        setBlob(recorded);
        setPreviewUrl(URL.createObjectURL(recorded));
        stream.getTracks().forEach((t) => t.stop());
        stopVisualizer();
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);

      // Forma de onda real (não simulada): lê o volume por faixa de frequência
      // direto do microfone via Web Audio API enquanto grava.
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      audioCtxRef.current = audioCtx;
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        const bars = Array.from({ length: WAVEFORM_BARS }, (_, i) => {
          const value = data[Math.floor((i * data.length) / WAVEFORM_BARS)];
          return Math.max(3, Math.round((value / 255) * 28));
        });
        setLevels(bars);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setError("Não foi possível acessar o microfone. Verifique a permissão do navegador.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  function discard() {
    setBlob(null);
    setPreviewUrl(null);
    setElapsed(0);
  }

  async function handleSend() {
    if (!blob) return;
    setUploading(true);
    setError(null);
    try {
      const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
      const file = new File([blob], `audio.${ext}`, { type: blob.type });
      const key = await uploadMedia(file);
      onSend({ type: "AUDIO", mediaUrl: key, text: "🎵 Áudio" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar áudio");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      {recording ? (
        <div className="flex flex-col items-center gap-3 rounded-lg bg-neutral-50 py-4 dark:bg-neutral-950/50">
          <button
            type="button"
            onClick={stopRecording}
            className="relative flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-600/20"
            aria-label="Parar gravação"
          >
            <span className="absolute inset-0 animate-ping rounded-full bg-red-600/40" />
            <span
              className="absolute inset-0 animate-ping rounded-full bg-red-600/25 [animation-delay:0.4s]"
            />
            <Square className="relative h-5 w-5" strokeWidth={2} fill="currentColor" />
          </button>

          <div className="flex h-8 items-end gap-0.5">
            {levels.map((h, i) => (
              <span
                key={i}
                className="w-1 rounded-full bg-red-500 transition-[height] duration-75 ease-out dark:bg-red-400"
                style={{ height: `${h}px` }}
              />
            ))}
          </div>

          <div className="text-center">
            <p className="text-xs font-medium text-red-600 dark:text-red-400">Gravando…</p>
            <p className="font-mono text-xs text-neutral-400 dark:text-neutral-500">{formatDuration(elapsed)}</p>
          </div>
        </div>
      ) : !blob ? (
        <button type="button" onClick={startRecording} className="btn-secondary btn-sm w-full justify-center">
          <Mic className="h-4 w-4" strokeWidth={2} />
          Gravar áudio
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <audio controls src={previewUrl ?? undefined} className="h-8 flex-1" />
          <button type="button" onClick={discard} className="icon-btn shrink-0" aria-label="Descartar">
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="button"
        disabled={sending || uploading || !blob}
        onClick={handleSend}
        className="btn-primary btn-sm w-full justify-center"
      >
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : "Enviar áudio"}
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

