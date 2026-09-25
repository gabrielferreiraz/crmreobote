import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { buildGoogleAuthUrl } from "@/lib/google-calendar-oauth";
import { safeInternalPath } from "@/lib/safe-redirect";

export const dynamic = "force-dynamic";

/** Início do fluxo — redireciona pro consentimento do Google. `state` guardado num cookie curto pra confirmar no callback que a volta é da mesma sessão que saiu (CSRF). */
export async function GET(req: NextRequest) {
  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.redirect(new URL("/login", process.env.NEXTAUTH_URL ?? "http://localhost:3000"));

  // Allowlist (ver lib/safe-redirect.ts): o filtro antigo deixava passar "/%09/evil.com" — open redirect real.
  const redirectPath = safeInternalPath(req.nextUrl.searchParams.get("redirect"));
  const state = randomUUID();
  const res = NextResponse.redirect(buildGoogleAuthUrl(state));
  res.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  if (redirectPath) {
    res.cookies.set("google_oauth_redirect", redirectPath, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
  }
  return res;
}
