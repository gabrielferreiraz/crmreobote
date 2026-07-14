import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { buildGoogleAuthUrl } from "@/lib/google-calendar-oauth";

export const dynamic = "force-dynamic";

/** Início do fluxo — redireciona pro consentimento do Google. `state` guardado num cookie curto pra confirmar no callback que a volta é da mesma sessão que saiu (CSRF). */
export async function GET() {
  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.redirect(new URL("/login", process.env.NEXTAUTH_URL ?? "http://localhost:3000"));

  const state = randomUUID();
  const res = NextResponse.redirect(buildGoogleAuthUrl(state));
  res.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
