import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { exchangeGoogleCode, fetchGoogleUserEmail } from "@/lib/google-calendar-oauth";
import { encryptSecret } from "@/lib/security/secret-crypto";
import { logAudit } from "@/lib/audit-log";
import { getClientIp } from "@/lib/rate-limit";
import { resolveInternalRedirect, safeInternalPath } from "@/lib/safe-redirect";

export const dynamic = "force-dynamic";

const DEFAULT_REDIRECT_PATH = "/configuracoes/perfil";

export async function GET(req: NextRequest) {
  const { organizationId, userId, session } = await requireSession();
  if (!organizationId || !userId) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const error = req.nextUrl.searchParams.get("error");
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("google_oauth_state")?.value;
  // Setado só quando o fluxo começou em algum lugar além de Configurações →
  // Perfil (ver ?redirect= em authorize/route.ts) — volta pra lá por padrão.
  // Revalida o valor do cookie (allowlist, ver lib/safe-redirect.ts) mesmo ele tendo sido
  // gravado por authorize/route.ts — defesa em profundidade contra open redirect.
  const redirectPath = safeInternalPath(req.cookies.get("google_oauth_redirect")?.value) ?? DEFAULT_REDIRECT_PATH;

  /** Destino final (?google=<status>) — sempre na própria origem, nunca fora do app. */
  function destination(status: string): URL {
    const url = resolveInternalRedirect(redirectPath, req.url, DEFAULT_REDIRECT_PATH);
    url.searchParams.set("google", status);
    return url;
  }

  function redirectWithCleanup(url: URL) {
    const res = NextResponse.redirect(url);
    res.cookies.delete("google_oauth_state");
    res.cookies.delete("google_oauth_redirect");
    return res;
  }

  if (error) {
    console.log(`[google-calendar] usuário negou consentimento: ${error}`);
    return redirectWithCleanup(destination("denied"));
  }
  if (!code || !state || !cookieState || state !== cookieState) {
    console.warn("[google-calendar] callback com state ausente/divergente — possível CSRF ou cookie expirado");
    return redirectWithCleanup(destination("error"));
  }

  try {
    const tokens = await exchangeGoogleCode(code);
    if (!tokens.refresh_token) {
      // Só vem na 1ª autorização (ou com prompt=consent, que já forçamos em
      // buildGoogleAuthUrl) — sem ele não dá pra renovar o acesso depois.
      console.error("[google-calendar] resposta sem refresh_token — reconexão necessária");
      return redirectWithCleanup(destination("error"));
    }

    const email = await fetchGoogleUserEmail(tokens.access_token);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const encryptedAccessToken = encryptSecret(tokens.access_token);
    const encryptedRefreshToken = encryptSecret(tokens.refresh_token!);

    await runWithTenant(organizationId, () =>
      prisma.googleCalendarConnection.upsert({
        where: { userId },
        create: {
          userId,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          expiresAt,
          calendarEmail: email,
          scope: tokens.scope,
        },
        update: {
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          expiresAt,
          calendarEmail: email,
          scope: tokens.scope,
        },
      }),
    );

    await logAudit({
      organizationId,
      actorUserId: userId,
      actorName: session!.user.name ?? session!.user.email ?? "?",
      action: "GOOGLE_CALENDAR_CONNECTED",
      targetType: "GoogleCalendarConnection",
      detail: email,
      ip: getClientIp(req),
    });

    return redirectWithCleanup(destination("connected"));
  } catch (err) {
    console.error("[google-calendar] falha ao trocar código por token", err);
    return redirectWithCleanup(destination("error"));
  }
}
