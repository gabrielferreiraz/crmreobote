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
 * Cria a instância já com o webhook configurado (mensagem recebida, status de
 * entrega/leitura e mudança de conexão tudo indo pro mesmo endpoint — o
 * receptor differencia pelo campo `event` do payload).
 */
export async function createInstance(instanceName: string, webhookUrl: string): Promise<void> {
  await request("/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      webhook: {
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"],
      },
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
): Promise<{ externalId?: string }> {
  const data = await request<{ key?: { id?: string } }>(
    `/message/sendText/${encodeURIComponent(instanceName)}`,
    {
      method: "POST",
      body: JSON.stringify({ number, text }),
    },
  );
  return { externalId: data.key?.id };
}

/**
 * Imagem via link direto (sem upload próprio) — o Evolution baixa a mídia da
 * URL informada e reenvia pro WhatsApp.
 */
export async function sendMediaMessage(
  instanceName: string,
  number: string,
  params: { mediatype: "image"; media: string; caption?: string },
): Promise<{ externalId?: string }> {
  const data = await request<{ key?: { id?: string } }>(
    `/message/sendMedia/${encodeURIComponent(instanceName)}`,
    {
      method: "POST",
      body: JSON.stringify({
        number,
        mediatype: params.mediatype,
        media: params.media,
        caption: params.caption,
      }),
    },
  );
  return { externalId: data.key?.id };
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
): Promise<{ externalId?: string }> {
  const data = await request<{ key?: { id?: string } }>(
    `/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`,
    {
      method: "POST",
      body: JSON.stringify({ number, audio: media, encoding: true }),
    },
  );
  return { externalId: data.key?.id };
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

export async function sendContactMessage(
  instanceName: string,
  number: string,
  contact: { name: string; phone: string },
): Promise<{ externalId?: string }> {
  const data = await request<{ key?: { id?: string } }>(
    `/message/sendContact/${encodeURIComponent(instanceName)}`,
    {
      method: "POST",
      body: JSON.stringify({
        number,
        contact: [{ fullName: contact.name, wuid: contact.phone, phoneNumber: contact.phone }],
      }),
    },
  );
  return { externalId: data.key?.id };
}

/**
 * Mensagem interativa com botões. Fora de uma conta WhatsApp Business API
 * oficial com template aprovado, alguns clientes de WhatsApp podem não
 * renderizar isso (restrição que a Meta vem aplicando de forma inconsistente
 * pra contas ligadas via QR Code/Baileys) — vale testar num aparelho real.
 */
export async function sendButtonsMessage(
  instanceName: string,
  number: string,
  params: { text: string; buttons: { label: string }[] },
): Promise<{ externalId?: string }> {
  const data = await request<{ key?: { id?: string } }>(
    `/message/sendButtons/${encodeURIComponent(instanceName)}`,
    {
      method: "POST",
      body: JSON.stringify({
        number,
        title: params.text,
        description: params.text,
        buttons: params.buttons.map((b, i) => ({
          type: "reply",
          displayText: b.label,
          id: `btn_${i}`,
        })),
      }),
    },
  );
  return { externalId: data.key?.id };
}

/** Mesma ressalva de suporte do sendButtonsMessage se aplica aqui. */
export async function sendListMessage(
  instanceName: string,
  number: string,
  params: { title: string; items: { title: string; description?: string }[] },
): Promise<{ externalId?: string }> {
  const data = await request<{ key?: { id?: string } }>(
    `/message/sendList/${encodeURIComponent(instanceName)}`,
    {
      method: "POST",
      body: JSON.stringify({
        number,
        title: params.title,
        description: params.title,
        buttonText: "Ver opções",
        sections: [
          {
            title: params.title,
            rows: params.items.map((item, i) => ({
              rowId: `item_${i}`,
              title: item.title,
              description: item.description ?? "",
            })),
          },
        ],
      }),
    },
  );
  return { externalId: data.key?.id };
}
