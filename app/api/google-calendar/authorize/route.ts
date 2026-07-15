import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { buildGoogleAuthUrl } from "@/lib/google-calendar-oauth";

export const dynamic = "force-dynamic";

// Só aceita path relativo de 1ª ordem ("/agenda") — bloqueia "//evil.com"
// (protocol-relative) e qualquer coisa que não comece com uma única barra,
// pra esse redirect "de volta pra onde a pessoa clicou" nunca virar um
// open-redirect pra fora do próprio app.
function safeRedirectPath(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  return value;
}

/** Início do fluxo — redireciona pro consentimento do Google. `state` guardado num cookie curto pra confirmar no callback que a volta é da mesma sessão que saiu (CSRF). */
export async function GET(req: NextRequest) {
  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.redirect(new URL("/login", process.env.NEXTAUTH_URL ?? "http://localhost:3000"));

  const redirectPath = safeRedirectPath(req.nextUrl.searchParams.get("redirect"));
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
