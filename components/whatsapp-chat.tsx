"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  Smile,
  PhoneMissed,
  PhoneOff,
  Phone,
  MoreVertical,
  FileText,
  Tag,
  ArrowDown,
} from "lucide-react";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { Modal } from "@/components/modal";
import { CurrencyInput } from "@/components/currency-input";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency } from "@/lib/format";

type MessageType = "TEXT" | "IMAGE" | "AUDIO" | "CONTACT" | "PIX" | "BUTTONS" | "LIST" | "STICKER" | "CALL";

type MessageMetadata = {
  name?: string;
  phone?: string;
  amount?: number;
  key?: string;
  buttons?: { label: string }[];
  items?: { title: string; description?: string }[];
  callStatus?: "RINGING" | "MISSED" | "REJECTED" | "ACCEPTED";
  isVideo?: boolean;
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

type ThreadPresence = {
  status: "available" | "unavailable" | "composing" | "recording" | "paused" | null;
  updatedAt: string | null;
  lastSeenAt: string | null;
};

/**
 * Rótulo de presença pro cabeçalho do chat — só existe quando já recebemos
 * pelo menos 1 atualização real (ver handlePresenceUpdate em
 * lib/whatsapp/events.ts); antes disso, ou se o contato tiver privacidade
 * restrita, nunca chega nada e o cabeçalho cai no telefone/"WhatsApp" de
 * sempre (ver chamador). "Visto por último" é aproximado (quando passou pra
 * "unavailable"), quase nunca é o horário oficial do WhatsApp — ver
 * comentário no schema.
 */
function presenceLabel(presence: ThreadPresence | null): { text: string; online: boolean } | null {
  if (!presence?.status) return null;
  if (presence.status === "composing") return { text: "digitando…", online: true };
  if (presence.status === "recording") return { text: "gravando áudio…", online: true };
  if (presence.status === "available") return { text: "online", online: true };

  const seenAt = presence.lastSeenAt ?? presence.updatedAt;
  if (!seenAt) return null;
  const time = new Date(seenAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return { text: `visto por último às ${time}`, online: false };
}

const QUOTE_PREVIEW_FALLBACK: Record<string, string> = {
  IMAGE: "📷 Imagem",
  AUDIO: "🎵 Áudio",
  CONTACT: "👤 Contato",
  PIX: "💰 Pix",
  STICKER: "🧩 Figurinha",
  CALL: "📞 Chamada",
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

// Áudio ganhou botão próprio (ícone de microfone sempre visível, do lado do
// clipe) — deixa mais óbvio que dá pra gravar rápido, sem precisar abrir o
// menu de anexo pra descobrir. O menu do clipe segue com o resto.
const PAPERCLIP_MENU_OPTIONS = ATTACH_OPTIONS.filter((o) => o.mode !== "AUDIO");

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "Reações",
    emojis: ["😀", "😂", "😊", "🙂", "😉", "😍", "🥰", "😘", "😅", "🤔", "😢", "😭", "😡", "😱", "😴", "🙄", "😎", "🤝"],
  },
  { label: "Gestos", emojis: ["👍", "👎", "👏", "🙏", "💪", "✌️", "👌", "🤞", "🤙", "👋"] },
  { label: "Corações", emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔"] },
  {
    label: "Negócio",
    emojis: ["✅", "❌", "⚠️", "🔥", "🎉", "💰", "💵", "🏠", "🚗", "📞", "📱", "📅", "⏰", "📍", "✍️", "📄"],
  },
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
  contactId,
  contactName,
  contactPhone,
  currentUserName,
  currentUserPhotoUrl,
}: {
  threadId: string;
  contactId?: string | null;
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
          contactId={contactId}
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
  contactId,
  contactName,
  contactPhone,
  currentUserName,
  currentUserPhotoUrl,
  onClose,
}: {
  threadId: string;
  contactId?: string | null;
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
        contactId={contactId}
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
  contactId,
  contactName,
  contactPhone,
  currentUserName,
  currentUserPhotoUrl,
  onClose,
}: {
  threadId: string;
  contactId?: string | null;
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
        contactId={contactId}
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
  contactId,
  contactName,
  contactPhone,
  currentUserName,
  currentUserPhotoUrl,
  onClose,
  className = "",
  backMode = false,
}: {
  threadId: string;
  contactId?: string | null;
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
  const [presence, setPresence] = useState<ThreadPresence | null>(null);
  const [contactPhotoUrl, setContactPhotoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [attachMode, setAttachMode] = useState<AttachMode | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [pastedImage, setPastedImage] = useState<File | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [photoLightboxOpen, setPhotoLightboxOpen] = useState(false);
  const [sendScriptOpen, setSendScriptOpen] = useState(false);
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  // Guarda se o usuário estava perto do fim ANTES da mensagem chegar — lido de
  // forma síncrona (não é estado) porque o polling de 4s troca `messages` o
  // tempo todo, e um re-render no meio do caminho não pode perder essa leitura.
  const wasNearBottomRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Reset do estado do botão ao trocar de conversa — ajuste de estado durante
  // a renderização (padrão recomendado pelo React pra "resetar estado quando
  // uma prop muda"), não dentro de um efeito. A ref (abaixo, num efeito
  // separado) não pode ser tocada aqui — só é seguro mexer em ref fora da
  // renderização (em efeito/handler), nunca durante o render em si.
  const [renderedThreadId, setRenderedThreadId] = useState(threadId);
  if (threadId !== renderedThreadId) {
    setRenderedThreadId(threadId);
    setShowScrollButton(false);
  }

  function isNearBottom(): boolean {
    const el = messagesContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function handleMessagesScroll() {
    const near = isNearBottom();
    wasNearBottomRef.current = near;
    setShowScrollButton(!near);
  }

  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    bottomRef.current?.scrollIntoView({ block: "end", behavior });
  }

  async function load() {
    try {
      const res = await fetch(`/api/whatsapp/messages/${threadId}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages);
        setPresence(data.presence);
      }
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
    // Só uma vez por troca de conversa (não entra no polling de 4s) — a rota
    // já cacheia no banco, mas evita repetir a requisição HTTP toda hora.
    setContactPhotoUrl(null);
    let cancelled = false;
    fetch(`/api/whatsapp/threads/${threadId}/photo`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.url) setContactPhotoUrl(data.url);
      })
      .catch(() => {
        // Silencioso: sem foto, o Avatar cai pras iniciais normalmente.
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  useEffect(() => {
    // Mutação de ref dentro de efeito é segura (diferente de durante o
    // render) — reseta a "memória" de scroll ao trocar de conversa.
    wasNearBottomRef.current = true;
  }, [threadId]);

  useEffect(() => {
    // O polling de 4s troca `messages` mesmo sem mensagem nova (nova
    // referência de array a cada fetch) — só desce a tela sozinho se o
    // usuário já estava perto do fim; se ele subiu pra ler algo antigo,
    // isso NUNCA deve puxar a tela de volta pra baixo.
    if (wasNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ block: "nearest" });
    }
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
      // Mandar uma mensagem sempre desce a tela pro final, mesmo que a pessoa
      // tivesse subido pra ler algo antigo — ela precisa ver o que acabou de mandar.
      wasNearBottomRef.current = true;
      setShowScrollButton(false);
      await load();
      return true;
    } catch {
      setError("Falha de conexão ao enviar mensagem.");
      return false;
    } finally {
      setSending(false);
    }
  }

  const content = (
    <div
      className={
        expanded
          ? "fixed inset-0 z-[60] flex min-h-0 flex-col bg-white p-4 dark:bg-neutral-950"
          : `flex min-h-0 flex-col ${className}`
      }
    >
      <div className="mb-2 flex shrink-0 items-center justify-between border-b border-neutral-200/60 pb-2 dark:border-neutral-800/60">
        <div className="flex min-w-0 items-center gap-2.5">
          {backMode && (
            <button type="button" onClick={onClose} className="icon-btn -ml-1 shrink-0" aria-label="Voltar">
              <ArrowLeft className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setPhotoLightboxOpen(true)}
            className="shrink-0 rounded-full transition-opacity hover:opacity-80"
            aria-label="Ver foto do contato"
          >
            <Avatar name={contactName ?? "?"} src={contactPhotoUrl} size="md" />
          </button>
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {contactName ?? "Conversa"}
              <WhatsAppIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
            </h2>
            {(() => {
              const label = presenceLabel(presence);
              if (!label) {
                return <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{contactPhone || "WhatsApp"}</p>;
              }
              return (
                <p className="flex items-center gap-1 truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {label.online && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />}
                  {label.text}
                </p>
              );
            })()}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <MoreMenu
            canTag={!!contactId}
            onSendScript={() => setSendScriptOpen(true)}
            onTag={() => setTagModalOpen(true)}
          />
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

      <div className="relative min-h-0 flex-1">
        <div
          ref={messagesContainerRef}
          onScroll={handleMessagesScroll}
          className="chat-bg-dots scrollbar-thin h-full space-y-1.5 overflow-y-auto rounded-lg bg-neutral-50 p-2.5 dark:bg-neutral-950/50"
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

        <button
          type="button"
          onClick={() => scrollToBottom()}
          aria-label="Ir para o final da conversa"
          tabIndex={showScrollButton ? 0 : -1}
          className={`absolute right-3 bottom-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-neutral-600 shadow-md ring-1 ring-black/5 transition-opacity duration-300 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-white/10 ${
            showScrollButton ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <ArrowDown className="h-4 w-4" strokeWidth={2} />
        </button>
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

      <div className="mt-2 shrink-0 border-t border-neutral-200/60 pt-2 dark:border-neutral-800/60">
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

      {photoLightboxOpen &&
        createPortal(
          <ContactPhotoLightbox
            url={contactPhotoUrl}
            onClose={() => setPhotoLightboxOpen(false)}
          />,
          document.body,
        )}

      {sendScriptOpen && <SendScriptModal threadId={threadId} onClose={() => setSendScriptOpen(false)} />}
      {tagModalOpen && contactId && (
        <TagContactModal contactId={contactId} onClose={() => setTagModalOpen(false)} />
      )}
    </div>
  );

  // "Modo foco" usa position:fixed pra cobrir a tela inteira — mas o
  // WhatsAppPanel (onde o ChatWindow normalmente vive) tem backdrop-blur, e
  // qualquer ancestral com backdrop-filter/filter vira o "containing block"
  // de um filho fixed (a especificação de CSS define isso), prendendo o
  // fixed dentro do painelzinho em vez de cobrir o viewport. Portal pro
  // body escapa desse problema não importa onde o ChatWindow esteja montado.
  if (expanded) return createPortal(content, document.body);
  return content;
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

  // Figurinha tem fundo transparente por natureza — meter ela dentro da bolha
  // colorida escondia a arte atrás de um retângulo. Renderiza "solta", igual
  // ao WhatsApp de verdade, só com o horário pequeno embaixo.
  const isSticker = message.type === "STICKER";

  return (
    <div className={`group flex items-end gap-1.5 ${isOut ? "justify-end" : "justify-start"}`}>
      {!isOut && avatar}
      {isOut && replyButton}
      <div
        className={
          isSticker
            ? "max-w-[55%]"
            : `max-w-[75%] rounded-2xl px-3 py-1.5 text-sm ${
                isOut
                  ? "rounded-br-sm bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "rounded-bl-sm bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
              }`
        }
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
        <p
          className={
            isSticker
              ? "mt-0.5 flex items-center gap-1 text-[10px] text-neutral-400 dark:text-neutral-500"
              : "mt-0.5 flex items-center gap-1 text-[10px] opacity-60"
          }
        >
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

/** Foto do contato em tela cheia (clicando no avatar do cabeçalho) — sem foto cacheada, mostra um estado "perfil sem foto" em vez de abrir vazio. */
function ContactPhotoLightbox({ url, onClose }: { url: string | null; onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full rounded-md object-contain"
        />
      ) : (
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex flex-col items-center gap-3 rounded-2xl bg-neutral-900 px-12 py-10"
        >
          <span className="flex h-24 w-24 items-center justify-center rounded-full bg-neutral-800">
            <User className="h-10 w-10 text-neutral-500" strokeWidth={1.5} />
          </span>
          <p className="text-sm text-neutral-400">Perfil sem foto</p>
        </div>
      )}
    </div>
  );
}

/** Menu "..." do cabeçalho do chat — ações que não cabem como ícone fixo (enviar script, etiquetar). */
function MoreMenu({
  canTag,
  onSendScript,
  onTag,
}: {
  canTag: boolean;
  onSendScript: () => void;
  onTag: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button type="button" onClick={() => setOpen((v) => !v)} className="icon-btn" aria-label="Mais opções">
        <MoreVertical className="h-4 w-4" strokeWidth={2} />
      </button>
      {open && (
        <div className="surface-glass absolute top-full right-0 z-30 mt-1 w-44 rounded-md p-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onSendScript();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-neutral-600 transition-colors hover:bg-neutral-100 active:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:active:bg-neutral-800"
          >
            <FileText className="h-3.5 w-3.5 opacity-60" strokeWidth={2} />
            Enviar script
          </button>
          <button
            type="button"
            disabled={!canTag}
            title={canTag ? undefined : "Vincule um contato do CRM primeiro"}
            onClick={() => {
              setOpen(false);
              onTag();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-neutral-600 transition-colors hover:bg-neutral-100 active:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-neutral-300 dark:hover:bg-neutral-800 dark:active:bg-neutral-800"
          >
            <Tag className="h-3.5 w-3.5 opacity-60" strokeWidth={2} />
            Etiquetar
          </button>
        </div>
      )}
    </div>
  );
}

type ScriptSummary = { id: string; name: string; steps: { text: string; delayAfterSec: number }[] };

/** Manda a sequência de um script salvo (ver Scripts) pra esta conversa — ver app/api/whatsapp/threads/[threadId]/send-script. */
function SendScriptModal({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const [scripts, setScripts] = useState<ScriptSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/message-scripts")
      .then((res) => {
        // Diferencia "sem scripts" de verdade de uma falha (permissão, rede
        // etc.) — senão os dois casos mostravam a mesma frase "nenhum script
        // cadastrado", escondendo um erro real.
        if (!res.ok) {
          setLoadError(true);
          return [];
        }
        return res.json();
      })
      .then((data) => setScripts(data))
      .catch(() => {
        setLoadError(true);
        setScripts([]);
      });
  }, []);

  async function handleSend() {
    if (!selectedId) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp/threads/${threadId}/send-script`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptId: selectedId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Erro ao enviar script");
        setSending(false);
        return;
      }
      setSent(true);
      setTimeout(onClose, 1200);
    } catch {
      setError("Falha de conexão ao enviar o script.");
      setSending(false);
    }
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Enviar script</h2>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
        Manda a sequência de mensagens do script escolhido pra esta conversa, respeitando o intervalo configurado entre elas.
      </p>

      {sent ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
          Enviando — acompanhe as mensagens chegando na conversa.
        </p>
      ) : !scripts ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando scripts…</p>
      ) : loadError ? (
        <p className="text-sm text-red-600 dark:text-red-400">Não foi possível carregar os scripts. Tente de novo.</p>
      ) : scripts.length === 0 ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">Nenhum script cadastrado ainda (Scripts, no menu do WhatsApp).</p>
      ) : (
        <div className="scrollbar-thin max-h-72 space-y-1 overflow-y-auto">
          {scripts.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedId(s.id)}
              className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                selectedId === s.id
                  ? "border-neutral-900 bg-neutral-50 dark:border-white dark:bg-neutral-800"
                  : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              }`}
            >
              <p className="font-medium text-neutral-900 dark:text-neutral-100">{s.name}</p>
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                {s.steps.length} mensage{s.steps.length === 1 ? "m" : "ns"}
              </p>
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!sent && (
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button type="button" disabled={!selectedId || sending} onClick={handleSend} className="btn-primary">
            {sending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {sending ? "Enviando" : "Enviar"}
          </button>
        </div>
      )}
    </Modal>
  );
}

/** Tags do Contact vinculado — só o campo tags (ver app/api/contacts/[id]/tags), nunca o resto do cadastro. */
function TagContactModal({ contactId, onClose }: { contactId: string; onClose: () => void }) {
  const [tagsInput, setTagsInput] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/contacts/${contactId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setTagsInput(((data?.tags ?? []) as string[]).join(", ")))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [contactId]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      const res = await fetch(`/api/contacts/${contactId}/tags`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Erro ao salvar etiquetas");
        setSaving(false);
        return;
      }
      onClose();
    } catch {
      setError("Falha de conexão ao salvar etiquetas.");
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-sm">
      <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Etiquetar contato</h2>
      <p className="mb-3 text-sm text-neutral-500 dark:text-neutral-400">Tags separadas por vírgula.</p>
      {!loaded ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando…</p>
      ) : (
        <input
          autoFocus
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="Ex.: quente, indeciso, sem resposta"
          className="field-input"
        />
      )}
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-ghost">
          Cancelar
        </button>
        <button type="button" disabled={!loaded || saving} onClick={handleSave} className="btn-primary">
          {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
          {saving ? "Salvando" : "Salvar"}
        </button>
      </div>
    </Modal>
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
    case "STICKER":
      return message.mediaUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={message.mediaUrl} alt="Figurinha" className="h-28 w-28 object-contain" />
      ) : (
        <p className="flex items-center gap-1.5 text-xs italic opacity-60">
          <ImageOff className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          Figurinha — não suportado
        </p>
      );
    case "CALL": {
      const status = message.metadata?.callStatus ?? "MISSED";
      const isVideo = !!message.metadata?.isVideo;
      const Icon = status === "MISSED" ? PhoneMissed : status === "REJECTED" ? PhoneOff : Phone;
      const label = isVideo ? "Chamada de vídeo" : "Chamada de voz";
      const statusLabel =
        status === "MISSED"
          ? "perdida"
          : status === "REJECTED"
            ? "recusada"
            : status === "ACCEPTED"
              ? "atendida"
              : "em andamento";
      return (
        <div className={`flex items-center gap-2 ${status === "MISSED" ? "text-red-500 dark:text-red-400" : ""}`}>
          <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
          <span>
            {label} <span className="opacity-70">{statusLabel}</span>
          </span>
        </div>
      );
    }
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

/** Picker curado (não é o teclado de emoji inteiro do SO) — cobre o que mais se usa numa conversa de vendas. */
function EmojiMenu({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button type="button" onClick={() => setOpen((v) => !v)} className="icon-btn" aria-label="Emojis">
        <Smile className="h-4 w-4" strokeWidth={2} />
      </button>
      {open && (
        <div className="surface-glass scrollbar-thin absolute bottom-full left-0 z-30 mb-2 max-h-64 w-64 space-y-2 overflow-y-auto rounded-md p-2 shadow-lg">
          {EMOJI_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="px-1 pb-1 text-[11px] font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
                {group.label}
              </p>
              <div className="grid grid-cols-8 gap-0.5">
                {group.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => onPick(emoji)}
                    className="flex h-7 w-7 items-center justify-center rounded text-base transition-colors hover:bg-neutral-100 active:bg-neutral-100 dark:hover:bg-neutral-800 dark:active:bg-neutral-800"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
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

  function insertEmoji(emoji: string) {
    const el = textareaRef.current;
    if (!el) {
      setText((t) => t + emoji);
      return;
    }
    const { selectionStart, selectionEnd, value } = el;
    const next = value.slice(0, selectionStart) + emoji + value.slice(selectionEnd);
    setText(next);
    const cursor = selectionStart + emoji.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
      autoResizeTextarea(el);
    });
  }

  const hasText = !!text.trim();

  return (
    <form onSubmit={handleSubmit}>
      <div className="relative rounded-3xl border border-neutral-200 bg-white transition-colors focus-within:border-neutral-400 focus-within:ring-1 focus-within:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:focus-within:border-neutral-500 dark:focus-within:ring-neutral-500">
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
          className="scrollbar-thin max-h-[120px] w-full resize-none bg-transparent py-3 pr-14 pl-4 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />

        <div className="flex items-center gap-0.5 px-2 pb-2">
          {FORMAT_OPTIONS.map((f) => (
            <button
              key={f.marker}
              type="button"
              onClick={() => applyFormat(f.marker)}
              className="icon-btn h-7 w-7"
              aria-label={f.label}
              title={`${f.label} (${f.shortcutLabel})`}
            >
              <f.icon className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          ))}
          <span className="mx-1 h-4 w-px shrink-0 bg-neutral-200 dark:bg-neutral-700" />
          <div className="relative shrink-0">
            <button type="button" onClick={onToggleMenu} className="icon-btn h-7 w-7" aria-label="Anexar">
              <Paperclip className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            {menuOpen && (
              <div className="surface-glass absolute bottom-full left-0 z-30 mb-2 w-40 rounded-md p-1 shadow-lg">
                {PAPERCLIP_MENU_OPTIONS.map((opt) => (
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
          <EmojiMenu onPick={insertEmoji} />
        </div>

        <button
          type="button"
          disabled={sending}
          onClick={() => (hasText ? submit() : onPick("AUDIO"))}
          className="absolute right-2 bottom-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white transition-all active:scale-95 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          aria-label={hasText ? "Enviar" : "Gravar áudio"}
          title={hasText ? "Enviar" : "Gravar áudio"}
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
          ) : hasText ? (
            <Send className="h-4 w-4" strokeWidth={2} />
          ) : (
            <Mic className="h-4 w-4" strokeWidth={2} />
          )}
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

