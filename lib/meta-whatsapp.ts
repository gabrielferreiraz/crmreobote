/**
 * Cliente da API oficial da Meta (WhatsApp Cloud API / Graph API), isolado
 * neste único arquivo de propósito — mesmo espírito de lib/evolution.ts: é a
 * única peça do sistema que sabe o formato exato dos endpoints do Graph API.
 * Convive com o Evolution (lib/evolution.ts), nunca o substitui — ver
 * WhatsAppInstance.provider em prisma/schema.prisma.
 *
 * Diferenças estruturais que valem lembrar em relação ao Evolution:
 * - Evolution é UM gateway compartilhado (credencial única via env, várias
 *   "instâncias" nomeadas nele). A Meta é N pares independentes de
 *   accessToken+phoneNumberId direto contra graph.facebook.com — cada linha
 *   de WhatsAppInstance META_CLOUD carrega a própria credencial (cifrada,
 *   ver lib/security/secret-crypto.ts), passada explicitamente em cada
 *   função aqui (não lida de env, ao contrário do Evolution).
 * - Não existe "status de conexão" real (open/close/connecting) — um número
 *   Cloud API "funciona" ou não (token válido/inválido, número
 *   registrado/não), não há sessão que caia sozinha.
 *
 * NUNCA importar este módulo em código que roda no cliente (componentes com
 * "use client") — ele lida com token de acesso e META_APP_SECRET.
 */

import {
  GRAPH_API_VERSION,
  MetaApiError,
  metaGraphRequest as request,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  verifyMetaWebhookSignature,
} from "@/lib/meta-graph";

export { GRAPH_API_VERSION, MetaApiError, exchangeCodeForToken, exchangeForLongLivedToken };
/** Mantido com o nome antigo aqui — quem importava de @/lib/meta-whatsapp não precisa mudar. */
export const verifyWebhookSignature = verifyMetaWebhookSignature;

/** Obrigatório depois de conectar — sem isso nenhuma mensagem/status chega no webhook. */
export async function subscribeAppToWaba(wabaId: string, accessToken: string): Promise<void> {
  await request(`/${wabaId}/subscribed_apps`, accessToken, { method: "POST" });
}

/**
 * Registra o número pra mandar/receber mensagem via Cloud API — o Embedded
 * Signup normalmente já deixa o número registrado sozinho, mas essa chamada
 * é idempotente e serve de rede de segurança caso não tenha ficado. Erro
 * aqui não é fatal pro fluxo de conexão (loga e segue) — na prática o
 * número quase sempre já está registrado quando chega aqui.
 */
export async function registerPhoneNumber(phoneNumberId: string, accessToken: string, pin: string): Promise<void> {
  try {
    await request(`/${phoneNumberId}/register`, accessToken, {
      method: "POST",
      body: JSON.stringify({ messaging_product: "whatsapp", pin }),
    });
  } catch (err) {
    console.error(`[meta-whatsapp] registro do número ${phoneNumberId} falhou (pode já estar registrado)`, err);
  }
}

// ─── Envio ────────────────────────────────────────────────────────────

type SendResult = { externalId?: string };

function toSendResult(data: { messages?: { id?: string }[] }): SendResult {
  return { externalId: data.messages?.[0]?.id };
}

/** `to` no mesmo formato normalizado usado no Evolution: só dígitos, com DDI (ex.: "5511999998888"). */
export async function sendTextMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string,
  replyToWamid?: string,
): Promise<SendResult> {
  const data = await request<{ messages?: { id?: string }[] }>(`/${phoneNumberId}/messages`, accessToken, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: text, preview_url: false },
      ...(replyToWamid ? { context: { message_id: replyToWamid } } : {}),
    }),
  });
  return toSendResult(data);
}

/** Imagem por link (mesma ideia do Evolution — a Meta baixa a URL informada), não pelo fluxo de upload por media_id. */
export async function sendMediaMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  params: { mediatype: "image"; media: string; caption?: string },
  replyToWamid?: string,
): Promise<SendResult> {
  const data = await request<{ messages?: { id?: string }[] }>(`/${phoneNumberId}/messages`, accessToken, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "image",
      image: { link: params.media, caption: params.caption },
      ...(replyToWamid ? { context: { message_id: replyToWamid } } : {}),
    }),
  });
  return toSendResult(data);
}

/** Áudio por link — Cloud API não aceita legenda em áudio (diferente da imagem). */
export async function sendAudioMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  media: string,
  replyToWamid?: string,
): Promise<SendResult> {
  const data = await request<{ messages?: { id?: string }[] }>(`/${phoneNumberId}/messages`, accessToken, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "audio",
      audio: { link: media },
      ...(replyToWamid ? { context: { message_id: replyToWamid } } : {}),
    }),
  });
  return toSendResult(data);
}

export async function sendContactMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  contact: { name: string; phone: string },
  replyToWamid?: string,
): Promise<SendResult> {
  const data = await request<{ messages?: { id?: string }[] }>(`/${phoneNumberId}/messages`, accessToken, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "contacts",
      contacts: [
        {
          name: { formatted_name: contact.name, first_name: contact.name.split(/\s+/)[0] || contact.name },
          phones: [{ phone: contact.phone, type: "CELL" }],
        },
      ],
      ...(replyToWamid ? { context: { message_id: replyToWamid } } : {}),
    }),
  });
  return toSendResult(data);
}

// ─── Mídia recebida ───────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * A Meta manda só um media_id no webhook — diferente do Evolution, que já
 * entrega a mídia decodificada. Dois passos: resolve a URL temporária
 * (curta duração, autenticada) e baixa o binário com o mesmo token.
 */
export async function downloadMedia(
  mediaId: string,
  accessToken: string,
): Promise<{ base64: string; mimetype: string } | null> {
  try {
    const meta = await request<{ url?: string; mime_type?: string }>(`/${mediaId}`, accessToken);
    if (!meta.url) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal });
      if (!res.ok) throw new MetaApiError(`Download de mídia respondeu ${res.status}`, res.status);
      const buffer = Buffer.from(await res.arrayBuffer());
      return { base64: buffer.toString("base64"), mimetype: meta.mime_type ?? "application/octet-stream" };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.error(`[meta-whatsapp] falha ao baixar mídia recebida ${mediaId}`, err);
    return null;
  }
}

// ─── Saúde do número ──────────────────────────────────────────────────

export type PhoneNumberHealth = {
  displayPhoneNumber?: string;
  verifiedName?: string;
  qualityRating?: string;
  codeVerificationStatus?: string;
};

/**
 * Substitui getConnectionState do Evolution — não existe "conectando", só
 * "a chamada autenticada funciona ou não" (token revogado/expirado vira
 * MetaApiError 401/403, tratado no health-check como equivalente a caído).
 */
export async function getPhoneNumberHealth(phoneNumberId: string, accessToken: string): Promise<PhoneNumberHealth> {
  const data = await request<{
    display_phone_number?: string;
    verified_name?: string;
    quality_rating?: string;
    code_verification_status?: string;
  }>(`/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`, accessToken);
  return {
    displayPhoneNumber: data.display_phone_number,
    verifiedName: data.verified_name,
    qualityRating: data.quality_rating,
    codeVerificationStatus: data.code_verification_status,
  };
}
