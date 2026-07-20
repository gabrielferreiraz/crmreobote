import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/require-role";
import { buildMetaAdsAuthUrl } from "@/lib/meta-ads";

export const dynamic = "force-dynamic";

/** Início do fluxo — redireciona pro consentimento da Meta. `state` guardado num cookie curto pra confirmar no callback que a volta é da mesma sessão que saiu (CSRF), mesmo padrão de /api/google-calendar/authorize. */
export async function GET() {
  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const state = randomUUID();
  const res = NextResponse.redirect(buildMetaAdsAuthUrl(state));
  res.cookies.set("meta_ads_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
