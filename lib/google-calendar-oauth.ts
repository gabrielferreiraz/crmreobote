import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/security/secret-crypto";
import { brazilDateStringToUTC } from "@/lib/timezone";

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
  // calendar.events (leitura+escrita de eventos) substituiu calendar.readonly
  // quando o agendamento via API v1 passou a criar evento de verdade no
  // Google (ver createGoogleCalendarEvent abaixo) — conexões feitas ANTES
  // desta mudança só têm o escopo de leitura antigo e precisam reconectar
  // (Perfil → Google Agenda → desconectar e conectar de novo) pra ganhar
  // permissão de escrita; até lá, createGoogleCalendarEvent falha com 403
  // pra elas, o que é tratado como "sincronização falhou" sem derrubar o
  // agendamento (ver app/api/v1/appointments/route.ts).
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

const CALENDAR_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/**
 * Confere se o escopo REALMENTE concedido por uma conexão (gravado em
 * GoogleCalendarConnection.scope na hora da troca do código OAuth — ver
 * app/api/google-calendar/callback/route.ts) inclui permissão de escrita.
 * Não basta olhar o SCOPES atual do código: uma conexão feita antes desta
 * constante ganhar calendar.events continua só com o escopo antigo
 * (leitura) até a pessoa reconectar — usado tanto pela tela de Perfil
 * (avisar "reconecte" sem esperar o 403 do Google) quanto por
 * GET /api/google-calendar/status.
 */
export function hasCalendarWriteScope(scope: string | null | undefined): boolean {
  return !!scope && scope.includes(CALENDAR_WRITE_SCOPE);
}

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
    // Sem isso, o Google lento/fora do ar prendia a carga da Agenda inteira
    // (loadGoogleEvents é chamado dentro de um Promise.all — ver
    // app/(dashboard)/agenda/page.tsx — que só resolve quando TODOS
    // terminam). Falha rápido em vez de travar a página por minutos.
    signal: AbortSignal.timeout(8_000),
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

export type GoogleConnection = { id: string; accessToken: string; refreshToken: string; expiresAt: Date };

/**
 * Renova o access token se estiver perto de expirar, já salvando o novo no
 * banco — quem chama nunca lida com token vencido. `accessToken`/
 * `refreshToken` chegam cifrados do banco (ver encryptSecret em
 * app/api/google-calendar/callback/route.ts); decryptSecret devolve o valor
 * como está se for uma linha legada gravada antes da cifra existir.
 */
export async function getValidGoogleAccessToken(connection: GoogleConnection): Promise<string> {
  const isExpiringSoon = connection.expiresAt.getTime() - 60_000 < Date.now();
  if (!isExpiringSoon) return decryptSecret(connection.accessToken);

  const refreshToken = decryptSecret(connection.refreshToken);
  const refreshed = await refreshGoogleAccessToken(refreshToken);
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
  await prisma.googleCalendarConnection.update({
    where: { id: connection.id },
    data: { accessToken: encryptSecret(refreshed.access_token), expiresAt },
  });
  return refreshed.access_token;
}

export type GoogleCalendarEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  htmlLink: string;
  description: string | null;
  location: string | null;
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
    // Mesmo motivo do timeout em requestGoogleToken acima.
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Falha ao buscar eventos do Google Agenda: ${res.status} ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      summary?: string;
      description?: string;
      location?: string;
      start?: { date?: string; dateTime?: string };
      end?: { date?: string; dateTime?: string };
      status?: string;
      htmlLink: string;
    }>;
  };

  // Evento de dia inteiro vem só como "YYYY-MM-DD" (start.date), sem hora
  // nem fuso — new Date("YYYY-MM-DD") cru interpreta isso como meia-noite
  // UTC (regra do próprio JS pra string só de data), não meia-noite local.
  // Com o Brasil 3h atrás do UTC, isso "empurrava" o evento pro dia
  // anterior assim que o navegador lia de volta com getDate()/getMonth()
  // (getters locais, ver task-calendar.tsx) — daí o "um dia a menos" que
  // só acontecia com evento de dia inteiro (evento com horário já vinha
  // com offset explícito em start.dateTime, nunca teve esse problema).
  // brazilDateStringToUTC ancora no meio-dia... meia-noite de Brasília de
  // verdade, então o getDate() do cliente sempre bate com o dia certo.
  function parseGoogleDate(field: { date?: string; dateTime?: string } | undefined): Date | null {
    if (!field) return null;
    if (field.dateTime) return new Date(field.dateTime);
    if (field.date) return brazilDateStringToUTC(field.date);
    return null;
  }

  return (data.items ?? [])
    .filter((item) => item.status !== "cancelled" && (item.start?.dateTime || item.start?.date))
    .map((item) => ({
      id: item.id,
      title: item.summary || "(Sem título)",
      start: parseGoogleDate(item.start)!,
      end: parseGoogleDate(item.end),
      allDay: !!item.start!.date && !item.start!.dateTime,
      htmlLink: item.htmlLink,
      description: item.description?.trim() || null,
      location: item.location?.trim() || null,
    }));
}

export type CreateGoogleCalendarEventInput = {
  title: string;
  description?: string | null;
  start: Date;
  end: Date;
};

/**
 * Contraparte de escrita de fetchGoogleCalendarEvents — cria o evento de
 * verdade no calendário principal da conta conectada. Usada só pelo
 * agendamento de reunião via API v1 (ver
 * app/api/v1/appointments/route.ts); precisa do escopo calendar.events (ver
 * SCOPES acima) — uma conexão antiga (só leitura) falha aqui com 403 até o
 * consultor reconectar.
 */
export async function createGoogleCalendarEvent(
  accessToken: string,
  input: CreateGoogleCalendarEventInput,
): Promise<{ id: string; htmlLink: string }> {
  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: input.title,
      description: input.description ?? undefined,
      start: { dateTime: input.start.toISOString() },
      end: { dateTime: input.end.toISOString() },
    }),
    // Mesmo motivo do timeout em requestGoogleToken/fetchGoogleCalendarEvents
    // acima — falha rápido em vez de segurar a resposta do agendamento
    // esperando o Google.
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Falha ao criar evento no Google Agenda: ${res.status} ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { id: string; htmlLink: string };
  return { id: data.id, htmlLink: data.htmlLink };
}
