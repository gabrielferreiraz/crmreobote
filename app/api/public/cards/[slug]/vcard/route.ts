import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { requireDigitalCard } from "@/lib/require-digital-card";
import { runWithTenant } from "@/lib/tenant-context";
import { getCardDetails, displayPhone } from "@/lib/digital-cards/queries";
import { buildVCard, vCardFileName } from "@/lib/digital-cards/vcard";
import { recordCardEvent } from "@/lib/digital-cards/events";
import { publicCardUrlFromHeaders } from "@/lib/digital-cards/public-url";

export const dynamic = "force-dynamic";

/** Gera o .vcf dinamicamente (nunca armazenado por usuário) e registra VCARD_DOWNLOAD. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sid") ?? undefined;
  const source = searchParams.get("src") ?? undefined;

  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { ok, organizationId, cardId } = await requireDigitalCard(slug, ip);
  if (!ok || !organizationId || !cardId) return NextResponse.json({ error: "Cartão não encontrado" }, { status: 404 });

  return runWithTenant(organizationId, async () => {
    const card = await getCardDetails(cardId);
    if (!card) return NextResponse.json({ error: "Cartão não encontrado" }, { status: 404 });

    const vcard = buildVCard({
      name: card.displayName,
      jobTitle: card.jobTitle,
      companyName: card.companyName,
      phone: displayPhone(card.phone),
      whatsapp: displayPhone(card.whatsapp),
      email: card.displayEmail,
      address: card.address,
      // hdrs (x-forwarded-proto/host), não new URL(req.url).origin — atrás
      // do proxy reverso do Easypanel, req.url reflete o endereço INTERNO
      // do container Docker (ex.: "https://<container-id>:3000"), nunca o
      // domínio real que o visitante usou. Mesmo bug-fix já aplicado na
      // página pública (app/c/[slug]/page.tsx) desde o início — aqui tinha
      // ficado pra trás, achado ao conferir CARD_PUBLIC_BASE_URL em
      // produção: o .vcf gerado vinha com uma URL interna sem sentido
      // nenhum embutida.
      publicUrl: publicCardUrlFromHeaders(slug, hdrs),
    });

    recordCardEvent(organizationId, cardId, "VCARD_DOWNLOAD", { sessionId, source }).catch(() => {});

    return new NextResponse(vcard, {
      headers: {
        "Content-Type": "text/vcard; charset=utf-8",
        "Content-Disposition": `attachment; filename="${vCardFileName(card.displayName)}"`,
      },
    });
  });
}
