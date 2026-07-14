import { prisma } from "@/lib/prisma";

/**
 * OAuth de verdade com o Google (token, refresh, ler eventos) — separado de
 * lib/google-calendar.ts (o link "quick add") porque aquele arquivo é
 * importado por um componente de cliente (task-row.tsx); misturar segredo de
 * servidor ali gera confusão de fronteira client/server. Um client OAuth só
 * (env vars abaixo) serve o app inteiro; cada usuário conecta a própria
 * conta aqui — ver model GoogleCalendarConnection em prisma/schema.prisma.
 */

function getRedirectUri(): string {
  const appUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  if (!appUrl) throw new Error("NEXTAUTH_URL não configurado");
  return `${appUrl}/api/google-calendar/callback`;
}

function getClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET não configurados");
  }
  return { clientId, clientSecret };
}

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export function buildGoogleAuthUrl(state: string): string {
  const { clientId } = getClientCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    // "consent" força o Google a mandar refresh_token de novo mesmo se a
    // pessoa já tinha autorizado antes — sem isso, reconectar depois de
    // desconectar poderia vir sem refresh_token (só é enviado na 1ª vez).
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
};

async function requestGoogleToken(body: Record<string, string>): Promise<GoogleTokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token endpoint respondeu ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function exchangeGoogleCode(code: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = getClientCredentials();
  return requestGoogleToken({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: getRedirectUri(),
  });
}

async function refreshGoogleAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const { clientId, clientSecret } = getClientCredentials();
  return requestGoogleToken({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
}

export async function fetchGoogleUserEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string };
    return data.email ?? null;
  } catch {
    return null;
  }
}

type GoogleConnection = { id: string; accessToken: string; refreshToken: string; expiresAt: Date };

/** Renova o access token se estiver perto de expirar, já salvando o novo no banco — quem chama nunca lida com token vencido. */
export async function getValidGoogleAccessToken(connection: GoogleConnection): Promise<string> {
  const isExpiringSoon = connection.expiresAt.getTime() - 60_000 < Date.now();
  if (!isExpiringSoon) return connection.accessToken;

  const refreshed = await refreshGoogleAccessToken(connection.refreshToken);
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
  await prisma.googleCalendarConnection.update({
    where: { id: connection.id },
    data: { accessToken: refreshed.access_token, expiresAt },
  });
  return refreshed.access_token;
}

export type GoogleCalendarEvent = {
  id: string;
  title: string;
  start: Date;
  allDay: boolean;
  htmlLink: string;
};

/** Busca eventos do calendário principal da conta conectada, dentro da janela [timeMin, timeMax]. */
export async function fetchGoogleCalendarEvents(
  accessToken: string,
  timeMin: Date,
  timeMax: Date,
): Promise<GoogleCalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Falha ao buscar eventos do Google Agenda: ${res.status} ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      summary?: string;
      start?: { date?: string; dateTime?: string };
      status?: string;
      htmlLink: string;
    }>;
  };

  return (data.items ?? [])
    .filter((item) => item.status !== "cancelled" && (item.start?.dateTime || item.start?.date))
    .map((item) => ({
      id: item.id,
      title: item.summary || "(Sem título)",
      start: new Date((item.start!.dateTime ?? item.start!.date)!),
      allDay: !!item.start!.date && !item.start!.dateTime,
      htmlLink: item.htmlLink,
    }));
}
