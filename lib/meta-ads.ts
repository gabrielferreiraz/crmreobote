/**
 * Cliente do Marketing API da Meta (Lead Ads + Conversions API), isolado
 * neste arquivo de propósito — mesmo espírito de lib/meta-whatsapp.ts, mas
 * produto diferente (Ads, não WhatsApp). Reaproveita o núcleo genérico de
 * lib/meta-graph.ts (troca de token OAuth, request autenticado, assinatura
 * de webhook) — é o MESMO App/credenciais, só os escopos pedidos mudam.
 *
 * NUNCA importar em código que roda no cliente ("use client") — lida com
 * token de página e App Secret.
 */

import { createHash } from "node:crypto";
import { getAppCredentials, metaGraphRequest as request } from "@/lib/meta-graph";

function getRedirectUri(): string {
  const appUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  if (!appUrl) throw new Error("NEXTAUTH_URL não configurado");
  return `${appUrl}/api/meta-ads/callback`;
}

// leads_retrieval: ler o lead completo depois do webhook de leadgen.
// pages_show_list/pages_manage_metadata: listar as Páginas do usuário e
// inscrever a Página no evento leadgen. ads_management/business_management:
// mandar evento de conversão (Conversions API) usando o mesmo token.
const SCOPES = [
  "pages_show_list",
  "pages_manage_metadata",
  "leads_retrieval",
  "ads_management",
  "business_management",
].join(",");

/** Início do fluxo de login (dialog tradicional, com redirect — não é o Embedded Signup do WhatsApp, que usa popup+JS SDK). */
export function buildMetaAdsAuthUrl(state: string): string {
  const { appId } = getAppCredentials();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: SCOPES,
    state,
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
}

export function getMetaAdsRedirectUri(): string {
  return getRedirectUri();
}

export type FacebookPage = { id: string; name: string; accessToken: string };

/** Páginas que o usuário administra, já com o próprio token de página (derivado do token de usuário — de longa duração se o de usuário for). */
export async function listOwnedPages(userAccessToken: string): Promise<FacebookPage[]> {
  const data = await request<{ data?: { id: string; name: string; access_token: string }[] }>(
    "/me/accounts?fields=id,name,access_token",
    userAccessToken,
  );
  return (data.data ?? []).map((p) => ({ id: p.id, name: p.name, accessToken: p.access_token }));
}

/** Obrigatório depois de conectar — sem isso a Página nunca manda o evento leadgen pro nosso webhook. */
export async function subscribePageToLeadgen(pageId: string, pageAccessToken: string): Promise<void> {
  await request(`/${pageId}/subscribed_apps?subscribed_fields=leadgen`, pageAccessToken, { method: "POST" });
}

type LeadgenFieldDatum = { name: string; values?: string[] };

export type LeadDetails = {
  id: string;
  createdTime: string;
  adId?: string;
  adName?: string;
  adSetId?: string;
  adSetName?: string;
  campaignId?: string;
  campaignName?: string;
  formId?: string;
  fields: Record<string, string>;
};

/** Nome de campo do formulário → chave normalizada que a gente reconhece (o resto some direto em `fields`, sem mapear). */
const FIELD_ALIASES: Record<string, string> = {
  full_name: "name",
  first_name: "firstName",
  last_name: "lastName",
  email: "email",
  phone_number: "phone",
  city: "city",
  job_title: "jobTitle",
  company_name: "company",
};

/**
 * Busca o lead completo a partir do leadgen_id que chega no webhook — é o
 * único jeito de saber QUAL anúncio/campanha/formulário gerou o lead (o
 * payload do webhook em si só traz o id, não os dados preenchidos nem a
 * atribuição).
 */
export async function fetchLeadDetails(leadgenId: string, pageAccessToken: string): Promise<LeadDetails> {
  const data = await request<{
    id: string;
    created_time: string;
    ad_id?: string;
    ad_name?: string;
    adset_id?: string;
    adset_name?: string;
    campaign_id?: string;
    campaign_name?: string;
    form_id?: string;
    field_data?: LeadgenFieldDatum[];
  }>(
    `/${leadgenId}?fields=id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data`,
    pageAccessToken,
  );

  const fields: Record<string, string> = {};
  for (const item of data.field_data ?? []) {
    const value = item.values?.[0];
    if (!value) continue;
    const key = FIELD_ALIASES[item.name] ?? item.name;
    fields[key] = value;
  }

  return {
    id: data.id,
    createdTime: data.created_time,
    adId: data.ad_id,
    adName: data.ad_name,
    adSetId: data.adset_id,
    adSetName: data.adset_name,
    campaignId: data.campaign_id,
    campaignName: data.campaign_name,
    formId: data.form_id,
    fields,
  };
}

// ─── Conversions API ────────────────────────────────────────────────

function sha256Lower(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export type ConversionUserData = {
  email?: string | null;
  phone?: string | null; // esperado só dígitos, com DDI (mesmo formato normalizado usado no resto do app)
};

export type ConversionEvent = {
  eventName: "Lead" | "Purchase" | "Schedule";
  eventTime: Date;
  eventId: string; // dedup do lado da Meta — usar o id do Deal/evento de origem
  user: ConversionUserData;
  value?: number;
  currency?: string;
};

/**
 * Manda um evento de conversão server-side pro Pixel — pra Meta aprender a
 * otimizar o público do anúncio a favor de quem realmente vira cliente
 * (negócio ganho), não só quem clicou. E-mail/telefone vão SEMPRE hasheados
 * (SHA-256), nunca em texto puro — exigência da própria Meta, e também
 * porque são PII (LGPD). `eventId` existe pra deduplicar contra o Pixel do
 * navegador, se um dia existir um — hoje só o lado servidor manda evento.
 */
export async function sendConversionEvent(pixelId: string, accessToken: string, event: ConversionEvent): Promise<void> {
  const userData: Record<string, string> = {};
  if (event.user.email) userData.em = sha256Lower(event.user.email);
  if (event.user.phone) userData.ph = sha256Lower(event.user.phone);

  await request(`/${pixelId}/events`, accessToken, {
    method: "POST",
    body: JSON.stringify({
      data: [
        {
          event_name: event.eventName,
          event_time: Math.floor(event.eventTime.getTime() / 1000),
          event_id: event.eventId,
          action_source: "system_generated",
          user_data: userData,
          ...(event.value != null
            ? { custom_data: { value: event.value, currency: event.currency ?? "BRL" } }
            : {}),
        },
      ],
    }),
  });
}
