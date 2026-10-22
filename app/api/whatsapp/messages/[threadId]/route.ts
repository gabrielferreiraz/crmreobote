import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { sendWhatsAppMessage, WhatsAppSendError } from "@/lib/whatsapp/send";
import { sendPresence } from "@/lib/evolution";
import { toDialNumber } from "@/lib/phone-normalize";
import { resolveChatMediaUrl, resolveAvatarUrlMap } from "@/lib/r2";
import { publishWhatsAppEvent } from "@/lib/whatsapp/live-events";
import { getWhatsAppThreadAccess } from "@/lib/whatsapp/thread-access";
import { assignCentralLead, CentralLeadError } from "@/lib/whatsapp/lead-routing";
import { findOpenCentralThreadForContact } from "@/lib/whatsapp/central-access";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import type { $Enums } from "@/app/generated/prisma/client";
import { readJson, bodyErrorResponse } from "@/lib/read-body";

export const dynamic = "force-dynamic";

// BUTTONS/LIST removidos: não é mais possível criar mensagens novas desses
// tipos (confirmado em produção que o WhatsApp não entrega/renderiza),
// embora mensagens antigas com esse type continuem existindo no histórico.
const VALID_TYPES: $Enums.WhatsAppMessageType[] = ["TEXT", "IMAGE", "AUDIO", "CONTACT", "PIX"];

// A inscrição de presença (ver lib/evolution.ts's sendPresence) não é
// permanente — renova nesse intervalo enquanto o chat fica aberto, meio
// segundo de folga a menos que o poll de 4s do frontend (ver
// components/whatsapp-chat.tsx) pra nunca ficar sem inscrição ativa.
const PRESENCE_RESUBSCRIBE_MS = 55_000;

// Sem isso, uma conversa antiga com milhares de mensagens trocadas era
// buscada INTEIRA a cada atualização (evento ao vivo + poll de segurança do
// chat aberto batem nesta mesma rota) — não é só "carrega tudo uma vez", é
// retransferir um histórico que só cresce a cada poll. Não existe hoje um
// "carregar mensagens mais antigas" ao rolar pra cima, então o corte é só
// nas mais recentes — mensagem mais antiga que isso fica sem aparecer no
// chat até esse recurso ser construído.
const MESSAGE_LIMIT = 200;

/** Garante que a conversa é da própria organização e está dentro do escopo de quem pediu (mesma regra do Pipeline). */
async function loadAuthorizedThread(
  threadId: string,
  organizationId: string,
  userId: string,
  role: string | undefined,
) {
  const thread = await prisma.whatsAppThread.findFirst({
    where: { id: threadId, organizationId },
    include: { instance: { select: { kind: true, personalOwnerId: true, instanceName: true, status: true } } },
  });
  if (!thread) return { thread: null, forbidden: false, access: null };
  const access = await getWhatsAppThreadAccess(organizationId, userId, role, thread);

  // ownerUserId (denormalizado, sobrevive à instância ser apagada de
  // verdade — ver prisma/schema.prisma), não personalOwnerId da instância: uma
  // conversa arquivada (instance null) ainda precisa respeitar o mesmo
  // escopo de "dono/admin vê tudo, consultor só o seu".
  if (!access.canRead) {
    return { thread: null, forbidden: true, access };
  }
  return { thread, forbidden: false, access };
}

export async function GET(_req: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;

  const { session, organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const { thread, forbidden, access } = await loadAuthorizedThread(threadId, organizationId, userId, session!.user.role);
    if (forbidden) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    if (!thread) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    // rawPayload nunca vai pro frontend — é o {key, message} bruto do
    // WhatsApp, só serve pra montar o "quoted" na hora de responder,
    // internamente (ver lib/whatsapp/send.ts).
    const messagesPromise = prisma.whatsAppMessage.findMany({
      where: { organizationId, threadId },
      orderBy: { createdAt: "desc" },
      take: MESSAGE_LIMIT,
      select: {
        id: true,
        direction: true,
        type: true,
        body: true,
        mediaUrl: true,
        metadata: true,
        status: true,
        createdAt: true,
        replyToId: true,
        replyTo: { select: { id: true, type: true, body: true, direction: true } },
        // image junto (não só name) — precisa do mesmo tratamento de avatar
        // que o resto do app já usa (ver resolveAvatarUrlMap abaixo), pro
        // balão de cada mensagem mostrar a FOTO de quem mandou de verdade,
        // não só o nome.
        sentBy: { select: { name: true, image: true } },
      },
    });

    // Abrir a conversa é o próprio ato de "ler" — some com a bolinha/contador
    // de não lidas na lista de Conversas e com o sinal de "lead respondeu" no
    // card do negócio. Existia aqui desde sempre e foi apagado sem querer em
    // d10c07b ("chat mostra quem enviou mensagem", 03/09) junto com a troca
    // deste trecho pelo threadOwnerUser abaixo — desde então NADA no sistema
    // marcava mensagem como lida, então o vermelho nunca sumia pra ninguém
    // (relato do consultor: "respondo, entro na conversa e continua marcada").
    //
    // SÓ quem é dono da conversa marca como lida. Supervisor/gerente/dono
    // abrindo conversa de um consultor NÃO consome o aviso dele: `read` é um
    // flag único por mensagem (não "lido por fulano"), então marcar aqui
    // apagaria o indicador do consultor que ainda nem olhou — pedido
    // explícito. ownerUserId nulo = conversa órfã (instância apagada quando o
    // dono foi desativado): nenhum consultor enxerga essa thread (ver
    // loadAuthorizedThread acima), então não há aviso de ninguém pra
    // preservar — marca normalmente, senão o contador fica preso pra sempre.
    const displayOwnerId = thread.inboxStatus ? thread.assigneeId : thread.ownerUserId;
    const threadOwnerPromise = displayOwnerId
      ? prisma.user.findUnique({ where: { id: displayOwnerId }, select: { name: true, image: true } })
      : Promise.resolve(null);
    const viewerOwnsThread = access?.isResponsibleViewer ?? false;
    if (viewerOwnsThread) {
      const marked = await prisma.whatsAppMessage.updateMany({
        where: { organizationId, threadId, direction: "INBOUND", read: false },
        data: { read: true },
      });
      // Só avisa quando ALGO mudou de verdade: o chat aberto recarrega a si
      // mesmo ao ouvir evento da própria thread (ver useWhatsAppLive em
      // components/whatsapp-chat.tsx), então publicar incondicionalmente aqui
      // viraria laço infinito de GET → evento → GET. Com a guarda, o 2º GET
      // marca 0 linhas, não publica, e o ciclo para. O que isso compra: a
      // lista de Conversas apaga o badge na hora, sem esperar o poll de 45s.
      if (marked.count > 0) {
        publishWhatsAppEvent(organizationId, { type: "read", threadId, central: thread.inboxStatus !== null });
      }
    }

    // Dono de verdade desta conversa (ownerUserId, não thread.instance —
    // sobrevive à instância ser apagada, ver comentário de
    // loadAuthorizedThread acima) — precisa aparecer como remetente de toda
    // mensagem OUTBOUND que não tenha `sentBy` (ou seja, foi o PRÓPRIO dono
    // quem mandou, do celular/app dele, não alguém "enviando como"). Pedido
    // explícito: o balão tem que refletir extremamente correto quem/qual
    // número mandou, nunca assumir que foi quem está com o chat aberto
    // agora (ver components/whatsapp-chat.tsx's MessageBubble, que já usou
    // currentUserName/currentUserPhotoUrl — o VIEWER — pra isso por engano).
    const [threadOwnerUser, messagesDesc] = await Promise.all([threadOwnerPromise, messagesPromise]);
    const messages = messagesDesc.reverse();

    const avatarMap = await resolveAvatarUrlMap([
      threadOwnerUser?.image,
      ...messages.map((m) => m.sentBy?.image),
    ]);

    // mediaUrl no banco pode ser uma chave interna do R2 (mídia enviada pelo
    // composer nativo) — o navegador precisa de uma URL de verdade pra exibir.
    const resolved = await Promise.all(
      messages.map(async (msg) => ({
        ...msg,
        mediaUrl: msg.mediaUrl ? await resolveChatMediaUrl(msg.mediaUrl) : msg.mediaUrl,
        sentBy: msg.sentBy
          ? { name: msg.sentBy.name, photoUrl: msg.sentBy.image ? (avatarMap.get(msg.sentBy.image) ?? null) : null }
          : null,
      })),
    );
    const threadOwner = threadOwnerUser
      ? { name: threadOwnerUser.name, photoUrl: threadOwnerUser.image ? (avatarMap.get(threadOwnerUser.image) ?? null) : null }
      : null;

    // Renova a inscrição de presença enquanto o chat fica aberto (o
    // frontend chama esta rota a cada 4s — ver components/whatsapp-chat.tsx).
    // Nunca aguarda nem falha a resposta principal por causa disso: é um
    // efeito colateral best-effort (ver lib/evolution.ts's sendPresence).
    const needsResubscribe =
      !thread.presenceSubscribedAt || Date.now() - thread.presenceSubscribedAt.getTime() > PRESENCE_RESUBSCRIBE_MS;
    if (thread.instance && thread.instance.status === "CONNECTED" && needsResubscribe) {
      // Mesma regra de lib/whatsapp/send.ts (ver toDialNumber: 55 só em número
      // brasileiro + correção do 9º dígito).
      const fullNumber = toDialNumber(thread.phoneNormalized) ?? thread.phoneNormalized;
      sendPresence(thread.instance.instanceName, fullNumber)
        .then(() => prisma.whatsAppThread.update({ where: { id: thread.id }, data: { presenceSubscribedAt: new Date() } }))
        .catch((err) => console.error("[wa:presence] falha ao renovar inscrição de presença", err));
    }

    return NextResponse.json({
      messages: resolved,
      threadOwner,
      presence: {
        status: thread.presenceStatus,
        updatedAt: thread.presenceUpdatedAt,
        lastSeenAt: thread.lastSeenAt,
      },
    });
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;

  const { session, organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  // Corpo lido só DEPOIS da autenticação e com teto (lib/read-body.ts) — a
  // mídia em si nunca vem aqui (só a chave do upload), 1 MB sobra.
  let requestBody: unknown;
  try {
    requestBody = await readJson(req);
  } catch (err) {
    const res = bodyErrorResponse(err);
    if (res) return res;
    throw err;
  }
  const { text, type, mediaUrl, metadata, replyToId } = requestBody as {
    text?: string;
    type?: string;
    mediaUrl?: string;
    metadata?: Record<string, unknown>;
    replyToId?: string;
  };

  // Generoso o bastante pra não incomodar conversa manual de verdade (pessoa
  // digitando), só freia um script/automação externa tentando disparar em
  // rajada por essa rota.
  const rateLimited = rateLimitOrResponse(`whatsapp-send:${userId}`, 60, 60_000);
  if (rateLimited) return rateLimited;

  if (!text?.trim()) return NextResponse.json({ error: "Mensagem vazia" }, { status: 400 });
  if (type && !VALID_TYPES.includes(type as $Enums.WhatsAppMessageType)) {
    return NextResponse.json({ error: "Tipo de mensagem inválido" }, { status: 400 });
  }

  return runWithTenant(organizationId, async () => {
    // Sem atalho de "assumir" para quem não enxerga a fila: só gestor (que
    // já lê "Sem responsável") assume ao responder; consultor recebe 403.
    const { thread, forbidden, access } = await loadAuthorizedThread(
      threadId,
      organizationId,
      userId,
      session!.user.role,
    );
    if (forbidden) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    if (!thread) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    // Gestor respondendo a fila assume na hora; o responsável respondendo um
    // atendimento encerrado o reabre com ele mesmo.
    const claimOnSend = access?.isCentral && (
      (thread.inboxStatus === "OPEN" && !thread.assigneeId) ||
      (thread.inboxStatus === "CLOSED" && thread.assigneeId === userId)
    );
    if (claimOnSend) {
      try {
        await assignCentralLead({
          organizationId,
          threadId,
          assigneeId: userId,
          actorUserId: userId,
          source: "MANUAL_CLAIM",
        });
      } catch (err) {
        if (err instanceof CentralLeadError) return NextResponse.json({ error: err.message }, { status: 409 });
        console.error(`[wa:central] falha ao assumir thread=${threadId} no envio`, err);
        return NextResponse.json({ error: "Não foi possível assumir a conversa. Tente de novo." }, { status: 500 });
      }
    } else if (!access?.canSend) {
      return NextResponse.json({ error: "Transfira a conversa para você antes de responder" }, { status: 409 });
    } else if (!access.isCentral && thread.contactId) {
      // Item 14: com atendimento aberto na Central, o cliente não recebe pelo número pessoal.
      const central = await findOpenCentralThreadForContact(organizationId, thread.contactId);
      if (central) {
        const who = central.assigneeId === userId ? "com você" : central.assignee ? `com ${central.assignee.name}` : "sem responsável";
        return NextResponse.json({ error: `Cliente em atendimento na Central (${who}). Responda por lá.` }, { status: 409 });
      }
    }

    try {
      const message = await sendWhatsAppMessage({
        organizationId,
        threadId,
        text: text.trim(),
        type: type as $Enums.WhatsAppMessageType | undefined,
        mediaUrl,
        metadata,
        replyToId,
        sentByUserId: userId,
      });
      return NextResponse.json(message, { status: 201 });
    } catch (err) {
      const message = err instanceof WhatsAppSendError ? err.message : "Falha ao enviar mensagem";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  });
}
