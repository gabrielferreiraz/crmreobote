/**
 * Núcleo genérico do Graph API da Meta — extraído de lib/meta-whatsapp.ts
 * pra ser reaproveitado por lib/meta-ads.ts (Lead Ads + Conversions API):
 * troca de código OAuth, request autenticado, verificação de assinatura de
 * webhook. É o MESMO App da Meta (mesmo NEXT_PUBLIC_META_APP_ID/
 * META_APP_SECRET) usado pra WhatsApp Cloud API — só o produto (WhatsApp vs.
 * Lead Ads/Marketing) e os escopos pedidos no login mudam.
 *
 * NUNCA importar este módulo em código que roda no cliente ("use client") —
 * ele lida com App Secret.
 */

import { createHmac } from "node:crypto";
import { secureEqual } from "@/lib/security/secure-compare";

export const GRAPH_API_VERSION = "v21.0";
export const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export class MetaApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

export function getAppCredentials(): { appId: string; appSecret: string } {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new MetaApiError("App da Meta não configurado (NEXT_PUBLIC_META_APP_ID/META_APP_SECRET ausentes)", 500);
  }
  return { appId, appSecret };
}

// Uma chamada de rede de terceiro nunca pode ficar pendurada pra sempre e
// travar quem chamou.
const REQUEST_TIMEOUT_MS = 15_000;

export async function metaGraphRequest<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${GRAPH_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...init?.headers,
      },
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "AbortError";
    console.error(`[meta-graph] ${timedOut ? "timeout" : "falha de rede"} em ${path}`, err);
    throw new MetaApiError(
      timedOut
        ? `Graph API não respondeu em ${REQUEST_TIMEOUT_MS / 1000}s (${path})`
        : `Falha de conexão com o Graph API (${path})`,
      0,
    );
  } finally {
    clearTimeout(timeout);
  }

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    // O corpo de erro do Graph API vem em {error:{message,type,code,
    // error_subcode,fbtrace_id}} — logado inteiro no servidor (nunca sobe
    // pro chamador) porque é onde aparece a causa real (token expirado,
    // permissão faltando, etc.).
    console.error(`[meta-graph] ${init?.method ?? "GET"} ${path} →`, JSON.stringify(json)?.slice(0, 500));
    const message = (json as { error?: { message?: string } } | null)?.error?.message;
    throw new MetaApiError(message ?? `Graph API respondeu ${res.status} em ${path}`, res.status);
  }

  console.log(`[meta-graph] ${init?.method ?? "GET"} ${path} → ${res.status}:`, JSON.stringify(json).slice(0, 1000));
  return json as T;
}

type TokenResponse = { access_token: string; token_type: string; expires_in?: number };

/** Troca o `code` que um fluxo OAuth (Embedded Signup ou dialog tradicional) devolve por um token de acesso de curta duração. */
export async function exchangeCodeForToken(code: string, redirectUri?: string): Promise<string> {
  const { appId, appSecret } = getAppCredentials();
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    code,
    ...(redirectUri ? { redirect_uri: redirectUri } : {}),
  });
  const data = await metaGraphRequest<TokenResponse>(`/oauth/access_token?${params.toString()}`, "");
  return data.access_token;
}

/**
 * Troca um token curto por um de longa duração (~60 dias) — a Meta não expõe
 * refresh_token como o Google; passado o prazo, precisa reconectar, não há
 * renovação silenciosa automática nessa entrega.
 */
export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<{ accessToken: string; expiresInSec?: number }> {
  const { appId, appSecret } = getAppCredentials();
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedToken,
  });
  const data = await metaGraphRequest<TokenResponse>(`/oauth/access_token?${params.toString()}`, "");
  return { accessToken: data.access_token, expiresInSec: data.expires_in };
}

/**
 * Verificação de assinatura de webhook — mesmo protocolo pra qualquer
 * produto da Meta (WhatsApp, Lead Ads, Messenger): corpo cru assinado com
 * HMAC-SHA256 usando o App Secret, mandado em X-Hub-Signature-256 como
 * "sha256=<hex>".
 */
export function verifyMetaWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  return secureEqual(provided, expected);
}
