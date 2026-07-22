/**
 * Cliente do Evolution API (WhatsApp), isolado neste único arquivo de propósito:
 * é a única peça do sistema que sabe o formato exato dos endpoints da v2.3.7.
 * Se algum nome de campo estiver diferente na instância real, o ajuste é feito
 * só aqui — nada fora deste arquivo conhece a forma das requisições/respostas
 * do Evolution.
 *
 * NUNCA importar este módulo em código que roda no cliente (componentes com
 * "use client") — ele lê EVOLUTION_API_KEY do ambiente do servidor.
 */

// Lista única de eventos que o webhook assina — usada tanto ao criar quanto
// ao reconfigurar uma instância, e comparada no diagnóstico de
// app/api/whatsapp/instance/route.ts pra saber se uma instância antiga
// precisa ser reconfigurada depois que um evento novo (ex.: CALL) é
// adicionado aqui.
// MESSAGES_SET: disparado pelo Evolution só na 1ª sincronização de histórico
// após escanear o QR Code (o WhatsApp manda esse histórico de propósito
// nesse momento, via protocolo multi-device) — usado como gatilho pra
// importar as conversas anteriores (ver lib/whatsapp/events.ts).
export const WEBHOOK_EVENTS = [
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "MESSAGES_SET",
  "CONNECTION_UPDATE",
  "CALL",
  "PRESENCE_UPDATE",
];

export class EvolutionApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "EvolutionApiError";
  }
}

function getConfig(): { baseUrl: string; apiKey: string } {
  const baseUrl = process.env.EVOLUTION_API_URL?.replace(/\/$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new EvolutionApiError("Evolution API não configurada (EVOLUTION_API_URL/EVOLUTION_API_KEY ausentes)", 500);
  }
  return { baseUrl, apiKey };
}

// Se o Evolution travar/não responder, a chamada não pode ficar pendurada pra
// sempre — isso já travou uma automação inteira (ou uma requisição de usuário)
// esperando uma API de terceiro que nem sempre está no ar.
const REQUEST_TIMEOUT_MS = 15_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { baseUrl, apiKey } = getConfig();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey,
        ...init?.headers,
      },
    });
  } catch (err) {
    // fetch() lança exceção crua (não uma resposta HTTP) em queda de rede,
    // DNS, ou abort por timeout — padroniza tudo isso num EvolutionApiError,
    // pra quem chama nunca precisar tratar dois formatos de erro diferentes.
    const timedOut = err instanceof Error && err.name === "AbortError";
    console.error(`[evolution] ${timedOut ? "timeout" : "falha de rede"} em ${path}`, err);
    throw new EvolutionApiError(
      timedOut
        ? `Evolution API não respondeu em ${REQUEST_TIMEOUT_MS / 1000}s (${path})`
        : `Falha de conexão com o Evolution API (${path})`,
      0,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    // O corpo do erro nunca sobe pro chamador (pode conter detalhes internos
    // do Evolution) — mas fica logado no servidor, porque é exatamente onde
    // costuma aparecer a causa real ("number is not a valid whatsapp number",
    // "instance not connected" etc.), sem isso o erro genérico não ajuda a
    // diagnosticar por que uma mensagem "foi enviada" mas não chegou.
    const errorBody = await res.text().catch(() => "");
    console.error(`[evolution] ${init?.method ?? "GET"} ${path} → ${res.status}:`, errorBody.slice(0, 500));
    throw new EvolutionApiError(`Evolution API respondeu ${res.status} em ${path}`, res.status);
  }

  if (res.status === 204) {
    console.log(`[evolution] ${init?.method ?? "GET"} ${path} → 204 (sem corpo)`);
    return undefined as T;
  }

  const json = await res.json();
  // Loga toda resposta bem-sucedida, não só erro — pra "sendButtons"/"sendList"
  // em especial, o Evolution pode responder 200 e mesmo assim a mensagem não
  // aparecer de fato no WhatsApp do destinatário (limitação da própria Meta
  // fora de conta Business API oficial); só vendo o corpo da resposta real dá
  // pra confirmar se o Evolution aceitou ou já avisou algo estranho aqui.
  console.log(`[evolution] ${init?.method ?? "GET"} ${path} → ${res.status}:`, JSON.stringify(json).slice(0, 1000));
  return json as T;
}

export type ConnectionState = "open" | "close" | "connecting";

/**
 * Referência "crua" de uma mensagem (key + message no formato do próprio
 * WhatsApp/Baileys) — é exatamente o que o Evolution espera no campo
 * `quoted` pra responder a uma mensagem específica, e também o que ele
 * devolve em toda resposta de envio bem-sucedida. Guardamos isso em cada
 * WhatsAppMessage (ver lib/whatsapp/send.ts e lib/whatsapp/events.ts)
 * justamente pra poder citar essa mensagem depois.
 */
export type MessageRef = { key: unknown; message: unknown };

type SendResult = { externalId?: string; ref?: MessageRef };

function toSendResult(data: { key?: { id?: string }; message?: unknown }): SendResult {
  if (!data.key) return {};
  return { externalId: data.key.id, ref: { key: data.key, message: data.message } };
}

export type EvolutionProxyConfig = {
  host: string;
  port: string;
  protocol: string;
  username?: string;
  password?: string;
};

/**
 * Cria a instância já com o webhook configurado (mensagem recebida, status de
 * entrega/leitura e mudança de conexão tudo indo pro mesmo endpoint — o
 * receptor differencia pelo campo `event` do payload).
 *
 * `proxy` (opcional — ver lib/whatsapp/proxy.ts): campos flat
 * proxyHost/proxyPort/proxyProtocol/proxyUsername/proxyPassword na raiz do
 * corpo, conforme documentação pública do Evolution API — não testado contra
 * uma instância real neste ambiente (sem servidor de dev disponível); se o
 * proxy não for aplicado na prática, é o primeiro lugar a revisar contra a
 * versão exata implantada.
 */
export async function createInstance(instanceName: string, webhookUrl: string, proxy?: EvolutionProxyConfig): Promise<void> {
  await request("/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      // Só afeta instâncias criadas a partir de agora — pede ao WhatsApp o
      // histórico de conversas no momento do pareamento (evento MESSAGES_SET
      // no webhook). Instância já existente não pode ser "voltada no tempo"
      // pra isso; só reconectando (novo QR Code) ganharia esse sync.
      syncFullHistory: true,
      webhook: {
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: WEBHOOK_EVENTS,
      },
      ...(proxy
        ? {
            proxyHost: proxy.host,
            proxyPort: proxy.port,
            proxyProtocol: proxy.protocol,
            ...(proxy.username ? { proxyUsername: proxy.username } : {}),
            ...(proxy.password ? { proxyPassword: proxy.password } : {}),
          }
        : {}),
    }),
  });
}

/** Retorna o QR Code (base64 de imagem) pra parear o número no app do WhatsApp. */
export async function getQrCode(instanceName: string): Promise<{ base64?: string; pairingCode?: string }> {
  const data = await request<{ base64?: string; pairingCode?: string }>(
    `/instance/connect/${encodeURIComponent(instanceName)}`,
  );
  return { base64: data.base64, pairingCode: data.pairingCode };
}

export async function getConnectionState(instanceName: string): Promise<ConnectionState> {
  const data = await request<{ instance?: { state?: string } }>(
    `/instance/connectionState/${encodeURIComponent(instanceName)}`,
  );
  const state = data.instance?.state;
  if (state === "open" || state === "connecting") return state;
  return "close";
}

export type PresenceState = "available" | "unavailable" | "composing" | "recording" | "paused";

/**
 * O efeito que a gente quer aqui — quando chamado com `presence: "available"`
 * (uso original, ver app/api/whatsapp/messages/[threadId]/route.ts) — não é
 * "mandar presença" em si, é o colateral: chamar este endpoint inscreve a
 * instância pra receber as atualizações de presença DESSE número via o
 * evento de webhook PRESENCE_UPDATE daqui em diante (confirmado no
 * código-fonte do serviço Baileys do próprio Evolution: o handler de
 * sendPresence chama `presenceSubscribe` antes de mandar a atualização). Não
 * existe endpoint separado só de "assinar" — e a inscrição não é permanente,
 * por isso quem chama isso pra esse fim precisa renovar periodicamente
 * enquanto o chat estiver aberto.
 *
 * `presence: "composing"` (ver simulateTyping abaixo) é o outro uso: simula
 * "digitando…" de verdade antes de uma mensagem de campanha, pro padrão de
 * envio se parecer mais com alguém digitando do que com um disparo instantâneo.
 */
/**
 * `delayMs` é obrigatório pro Evolution (400 "instance requires property
 * \"delay\"" sem ele) — é quanto tempo (ms) o Baileys mantém essa presença
 * antes de voltar sozinho pro estado anterior. Pra `composing`, é natural
 * passar o mesmo tempo que a gente já espera em simulateTyping antes de
 * mandar a mensagem de verdade; pro uso de inscrição (`available`, ver
 * app/api/whatsapp/messages/[threadId]/route.ts) o valor não tem efeito
 * prático, só precisa existir.
 */
export async function sendPresence(
  instanceName: string,
  number: string,
  presence: PresenceState = "available",
  delayMs: number = 1000,
): Promise<void> {
  await request(`/chat/sendPresence/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    body: JSON.stringify({ number, presence, delay: delayMs }),
  });
}

const TYPING_WPM = 45; // palavras por minuto — média de digitação em celular, mesma ordem de grandeza usada por middlewares anti-ban públicos (ex.: baileys-antiban)
const MIN_TYPING_MS = 800;
const MAX_TYPING_MS = 6_000;

/**
 * "Digita" antes de mandar — chama sendPresence(..., "composing"), espera um
 * tempo proporcional ao tamanho do texto (~45 palavras/min, uma palavra ~=5
 * caracteres), e retorna. Quem chama despacha a mensagem de verdade depois.
 * Nunca lança: falha aqui (instância não aceita presença, timeout) nunca pode
 * bloquear o envio real, que é o que importa de verdade.
 */
export async function simulateTyping(instanceName: string, number: string, textLength: number): Promise<void> {
  const charsPerSecond = (TYPING_WPM * 5) / 60;
  const estimatedMs = (textLength / charsPerSecond) * 1000;
  const waitMs = Math.min(MAX_TYPING_MS, Math.max(MIN_TYPING_MS, estimatedMs));

  try {
    await sendPresence(instanceName, number, "composing", Math.round(waitMs));
  } catch (err) {
    console.error(`[evolution] falha ao simular digitação pra ${number} (seguindo com o envio normalmente)`, err);
  }
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

/**
 * Foto de perfil do WhatsApp de um número — `number` no mesmo formato que
 * sendTextMessage (só dígitos, com DDI). Retorna null (não lança) quando o
 * contato não tem foto, tem privacidade restrita, ou o Evolution não
 * reconhece o número — tudo isso é resultado normal, não erro de verdade.
 */
export async function fetchProfilePictureUrl(instanceName: string, number: string): Promise<string | null> {
  try {
    const data = await request<{ profilePictureUrl?: string; wuid?: string } | null>(
      `/chat/fetchProfilePictureUrl/${encodeURIComponent(instanceName)}`,
      { method: "POST", body: JSON.stringify({ number }) },
    );
    return data?.profilePictureUrl ?? null;
  } catch (err) {
    console.error(`[evolution] falha ao buscar foto de perfil de ${number}`, err);
    return null;
  }
}

/**
 * Mensagem "crua" devolvida pelo histórico — mesmo formato de
 * key/message/pushName que chega em `messages.upsert` em tempo real, mais
 * `messageTimestamp` (epoch, em segundos ou ms conforme a versão).
 */
export type HistoryMessage = {
  key?: { remoteJid?: string; fromMe?: boolean; id?: string };
  pushName?: string;
  message?: unknown;
  messageTimestamp?: number | string;
};

// Confirmado em produção que este endpoint É paginado de verdade (uma conta
// ativa chegou a reportar 467 páginas) — cada página só traz as mensagens
// mais recentes de TODA a instância (grupo, canal, contato, tudo misturado),
// então uma única página cobre muito pouco de qualquer contato específico:
// com muitos contatos, um teto baixo de páginas se espalha tão fino que boa
// parte deles fica só com a última mensagem. Esse é o teto padrão, usado
// pelo gatilho automático do webhook (MESSAGES_SET) — ele precisa responder
// rápido pro Evolution não reenviar o evento à toa, então fica conservador.
// O import manual (botão "Importar histórico") passa um teto bem maior via
// o parâmetro `maxPages` de findMessages, já que ali não tem esse limite de
// tempo — é só esse caminho que de fato busca profundidade por contato.
const MAX_HISTORY_PAGES = 10;

type FindMessagesPage = { records: HistoryMessage[]; totalPages: number };

function parseFindMessagesPage(data: unknown): FindMessagesPage {
  if (Array.isArray(data)) return { records: data as HistoryMessage[], totalPages: 1 };

  const asRecord = data as Record<string, unknown> | null;
  const messagesField = asRecord?.messages;
  if (Array.isArray(messagesField)) return { records: messagesField as HistoryMessage[], totalPages: 1 };
  if (messagesField && typeof messagesField === "object") {
    const messagesObj = messagesField as Record<string, unknown>;
    const records = Array.isArray(messagesObj.records) ? (messagesObj.records as HistoryMessage[]) : [];
    const totalPages = typeof messagesObj.pages === "number" ? messagesObj.pages : 1;
    return { records, totalPages };
  }
  if (Array.isArray(asRecord?.records)) {
    const totalPages = typeof asRecord?.pages === "number" ? (asRecord.pages as number) : 1;
    return { records: asRecord.records as HistoryMessage[], totalPages };
  }
  return { records: [], totalPages: 1 };
}

/**
 * Histórico de mensagens já sincronizado pelo Evolution (populado no
 * pareamento, quando a instância foi criada com `syncFullHistory: true`).
 * O filtro por `remoteJid` desse endpoint é conhecidamente instável entre
 * versões do Evolution — busca várias páginas (até MAX_HISTORY_PAGES) e
 * filtra/agrupa por contato do nosso lado (ver lib/whatsapp/events.ts) em vez
 * de confiar nele. A forma da resposta também varia (array puro, ou paginada
 * em `{ messages: { records, pages } }` / `{ records, pages }`) — trata as
 * três; quando a forma não informa `pages` (array puro/versão antiga),
 * assume 1 página só e não insiste.
 */
export async function findMessages(instanceName: string, maxPages: number = MAX_HISTORY_PAGES): Promise<HistoryMessage[]> {
  const allMessages: HistoryMessage[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const data = await request<unknown>(`/chat/findMessages/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: JSON.stringify({ where: {}, page }),
    });

    const parsed = parseFindMessagesPage(data);
    if (parsed.records.length === 0) break; // nada nesta página — nada de novo esperar nas seguintes
    allMessages.push(...parsed.records);
    totalPages = parsed.totalPages;
    page += 1;
  } while (page <= totalPages && page <= maxPages);

  return allMessages;
}

export async function logoutInstance(instanceName: string): Promise<void> {
  await request(`/instance/logout/${encodeURIComponent(instanceName)}`, { method: "DELETE" });
}

export async function deleteInstance(instanceName: string): Promise<void> {
  await request(`/instance/delete/${encodeURIComponent(instanceName)}`, { method: "DELETE" });
}

/**
 * `number` deve ser o número normalizado, só dígitos, com DDI
 * (ex.: "5511999998888"). Retorna o id da mensagem no WhatsApp, usado depois
 * pra correlacionar com o webhook de status (entregue/lido).
 */
export async function sendTextMessage(
  instanceName: string,
  number: string,
  text: string,
  quoted?: MessageRef,
): Promise<SendResult> {
  const data = await request<{ key?: { id?: string }; message?: unknown }>(
    `/message/sendText/${encodeURIComponent(instanceName)}`,
    {
      method: "POST",
      body: JSON.stringify({ number, text, quoted }),
    },
  );
  return toSendResult(data);
}

/**
 * O payload de webhook de uma mensagem recebida com mídia (imagem, áudio…)
 * só traz a URL criptografada do próprio WhatsApp — não dá pra baixar/exibir
 * direto. Este endpoint devolve o conteúdo já decriptado em base64; `message`
 * é o objeto bruto da mensagem (o mesmo `data` recebido no webhook).
 */
export async function getIncomingMediaBase64(
  instanceName: string,
  message: unknown,
): Promise<{ base64: string; mimetype: string; caption?: string } | null> {
  try {
    const data = await request<{ base64?: string; mimetype?: string; caption?: string }>(
      `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
      {
        method: "POST",
        body: JSON.stringify({ message }),
      },
    );
    if (!data.base64) return null;
    return { base64: data.base64, mimetype: data.mimetype ?? "application/octet-stream", caption: data.caption };
  } catch (err) {
    console.error(`[evolution] falha ao baixar mídia recebida de ${instanceName}`, err);
    return null;
  }
}

/**
 * Imagem via link direto (sem upload próprio) — o Evolution baixa a mídia da
 * URL informada e reenvia pro WhatsApp.
 */
export async function sendMediaMessage(
  instanceName: string,
  number: string,
  params: { mediatype: "image"; media: string; caption?: string },
  quoted?: MessageRef,
): Promise<SendResult> {
  const data = await request<{ key?: { id?: string }; message?: unknown }>(
    `/message/sendMedia/${encodeURIComponent(instanceName)}`,
    {
      method: "POST",
      body: JSON.stringify({
        number,
        mediatype: params.mediatype,
        media: params.media,
        caption: params.caption,
        quoted,
      }),
    },
  );
  return toSendResult(data);
}

/**
 * Áudio como nota de voz (PTT) de verdade — usa o endpoint dedicado do
 * Evolution (não o /message/sendMedia genérico). `encoding: true` manda o
 * próprio Evolution converter o áudio pra ogg/opus via ffmpeg antes de
 * enviar; sem isso, um áudio gravado no navegador (audio/webm) chega no
 * WhatsApp como uma mensagem que o app não consegue tocar, mesmo a API
 * respondendo 201 (o envio "funciona" do ponto de vista da API, só o
 * conteúdo é incompatível com o player do WhatsApp).
 */
export async function sendAudioMessage(
  instanceName: string,
  number: string,
  media: string,
  quoted?: MessageRef,
): Promise<SendResult> {
  const data = await request<{ key?: { id?: string }; message?: unknown }>(
    `/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`,
    {
      method: "POST",
      body: JSON.stringify({ number, audio: media, encoding: true, quoted }),
    },
  );
  return toSendResult(data);
}

/**
 * Só leitura — usada para diagnosticar se o webhook de fato está habilitado
 * e com os eventos certos no lado do Evolution (fonte da verdade real,
 * independente do que a gente pediu no /instance/create).
 */
export async function getWebhookConfig(
  instanceName: string,
): Promise<{ enabled?: boolean; url?: string; events?: string[] } | null> {
  try {
    return await request(`/webhook/find/${encodeURIComponent(instanceName)}`);
  } catch (err) {
    console.error(`[evolution] falha ao consultar config de webhook de ${instanceName}`, err);
    return null;
  }
}

/**
 * Reconfigura o webhook de uma instância já existente. Necessário porque
 * NEXTAUTH_URL errado (ex.: "localhost" em vez do domínio público) faz o
 * Evolution gravar uma URL de webhook inalcançável na hora da criação — e
 * corrigir a env var sozinha não conserta instâncias que já existem, porque
 * o Evolution guarda a URL antiga no próprio banco dele até alguém chamar
 * este endpoint de novo.
 */
export async function setWebhookConfig(instanceName: string, webhookUrl: string): Promise<void> {
  await request(`/webhook/set/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: WEBHOOK_EVENTS,
      },
    }),
  });
}

export async function sendContactMessage(
  instanceName: string,
  number: string,
  contact: { name: string; phone: string },
  quoted?: MessageRef,
): Promise<SendResult> {
  const data = await request<{ key?: { id?: string }; message?: unknown }>(
    `/message/sendContact/${encodeURIComponent(instanceName)}`,
    {
      method: "POST",
      body: JSON.stringify({
        number,
        contact: [{ fullName: contact.name, wuid: contact.phone, phoneNumber: contact.phone }],
        quoted,
      }),
    },
  );
  return toSendResult(data);
}

// sendButtonsMessage/sendListMessage existiram e foram removidas: o payload
// real (interactiveMessage/nativeFlowMessage dentro de viewOnceMessage, visto
// em produção) confirma que é o truque não-oficial do Baileys pra simular
// botões — a Meta não garante entrega/renderização disso fora de conta
// WhatsApp Business API oficial, e na prática não chegou pro destinatário.
// Mensagens do tipo BUTTONS/LIST já enviadas antes continuam existindo no
// histórico (schema mantém o enum), só não é mais possível criar novas.
