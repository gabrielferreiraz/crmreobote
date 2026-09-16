import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { requireDigitalCard } from "@/lib/require-digital-card";
import { runWithTenant } from "@/lib/tenant-context";
import { recordCardEvent } from "@/lib/digital-cards/events";
import { prisma } from "@/lib/prisma";
import type { $Enums } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

// Só os eventos de CLIQUE (disparados pelo visitante no navegador) — CARD_VIEW
// é gravado direto pelo Server Component da página (app/c/[slug]/page.tsx),
// nunca por aqui. VCARD_DOWNLOAD tem rota própria (vcard/route.ts, que já
// gera o arquivo E registra o evento na mesma resposta).
const CLICK_EVENT_TYPES = new Set([
  "WHATSAPP_CLICK",
  "PHONE_CLICK",
  "EMAIL_CLICK",
  "MAP_CLICK",
  "INSTAGRAM_CLICK",
  "LINKEDIN_CLICK",
  "LINK_CLICK",
  "SHARE_CLICK",
  // Achado na revisão: digital-card-actions.tsx sempre chamou
  // onTrack("QR_CODE_OPEN") ao abrir o modal do QR (manual ou via ?qr=1),
  // mas faltava tanto aqui quanto no enum DigitalCardEventType — o POST
  // dava 400 silencioso toda vez (ver migration
  // 20260916180000_digital_card_review_fixes).
  "QR_CODE_OPEN",
]);

/**
 * Registra 1 clique do visitante — público, sem login, rate-limited (ver
 * requireDigitalCard). Nunca bloqueia a ação do visitante (o botão já abriu
 * o WhatsApp/telefone/mapa antes desta chamada terminar, ver
 * components/digital-card/digital-card-contact-actions.tsx) — falha aqui só
 * significa "não contou pra métrica", nunca "não funcionou".
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await req.json().catch(() => ({}));
  const { eventType, sessionId, source, presentationId } = body as {
    eventType?: string;
    sessionId?: string;
    source?: string;
    presentationId?: string;
  };

  if (!eventType || !CLICK_EVENT_TYPES.has(eventType)) {
    return NextResponse.json({ error: "Evento inválido" }, { status: 400 });
  }

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { ok, organizationId, cardId } = await requireDigitalCard(slug, ip);
  if (!ok || !organizationId || !cardId) return NextResponse.json({ error: "Cartão não encontrado" }, { status: 404 });

  await runWithTenant(organizationId, async () => {
    await recordCardEvent(organizationId, cardId, eventType as $Enums.DigitalCardEventType, { sessionId, source });

    // Se o clique veio de dentro de uma apresentação presencial em
    // andamento (ver visitorSessionId/whatsappClicked/instagramClicked no
    // schema — sinais extra pra correlação, sempre best-effort, nunca prova).
    if (presentationId) {
      const patch: Record<string, boolean> = {};
      if (eventType === "WHATSAPP_CLICK") patch.whatsappClicked = true;
      if (eventType === "INSTAGRAM_CLICK") patch.instagramClicked = true;
      if (Object.keys(patch).length > 0) {
        await prisma.digitalCardPresentation.updateMany({ where: { id: presentationId, cardId }, data: patch }).catch(() => {});
      }
    }
  });

  return NextResponse.json({ ok: true });
}
