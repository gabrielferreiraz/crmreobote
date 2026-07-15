import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { exchangeGoogleCode, fetchGoogleUserEmail } from "@/lib/google-calendar-oauth";

export const dynamic = "force-dynamic";

const DEFAULT_REDIRECT_PATH = "/configuracoes/perfil";

export async function GET(req: NextRequest) {
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const error = req.nextUrl.searchParams.get("error");
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("google_oauth_state")?.value;
  // Setado só quando o fluxo começou em algum lugar além de Configurações →
  // Perfil (ver ?redirect= em authorize/route.ts) — volta pra lá por padrão.
  const redirectPath = req.cookies.get("google_oauth_redirect")?.value || DEFAULT_REDIRECT_PATH;

  function redirectWithCleanup(url: URL) {
    const res = NextResponse.redirect(url);
    res.cookies.delete("google_oauth_state");
    res.cookies.delete("google_oauth_redirect");
    return res;
  }

  if (error) {
    console.log(`[google-calendar] usuário negou consentimento: ${error}`);
    return redirectWithCleanup(new URL(`${redirectPath}?google=denied`, req.url));
  }
  if (!code || !state || !cookieState || state !== cookieState) {
    console.warn("[google-calendar] callback com state ausente/divergente — possível CSRF ou cookie expirado");
    return redirectWithCleanup(new URL(`${redirectPath}?google=error`, req.url));
  }

  try {
    const tokens = await exchangeGoogleCode(code);
    if (!tokens.refresh_token) {
      // Só vem na 1ª autorização (ou com prompt=consent, que já forçamos em
      // buildGoogleAuthUrl) — sem ele não dá pra renovar o acesso depois.
      console.error("[google-calendar] resposta sem refresh_token — reconexão necessária");
      return redirectWithCleanup(new URL(`${redirectPath}?google=error`, req.url));
    }

    const email = await fetchGoogleUserEmail(tokens.access_token);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await runWithTenant(organizationId, () =>
      prisma.googleCalendarConnection.upsert({
        where: { userId },
        create: {
          userId,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token!,
          expiresAt,
          calendarEmail: email,
        },
        update: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token!,
          expiresAt,
          calendarEmail: email,
        },
      }),
    );

    return redirectWithCleanup(new URL(`${redirectPath}?google=connected`, req.url));
  } catch (err) {
    console.error("[google-calendar] falha ao trocar código por token", err);
    return redirectWithCleanup(new URL(`${redirectPath}?google=error`, req.url));
  }
}
