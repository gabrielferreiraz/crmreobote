import { headers } from "next/headers";
import { requireDigitalCard } from "@/lib/require-digital-card";
import { runWithTenant } from "@/lib/tenant-context";
import { getCardDetails, displayPhone } from "@/lib/digital-cards/queries";
import { recordCardEvent } from "@/lib/digital-cards/events";
import { publicCardUrlFromHeaders } from "@/lib/digital-cards/public-url";
import { DigitalCardView, type DigitalCardData } from "@/components/digital-card/digital-card-view";

export const dynamic = "force-dynamic";

/**
 * Página pública (sem login) do Cartão Digital — mesma família de
 * `/t/[code]` (ver lib/require-digital-card.ts, que resolve organizationId
 * a partir do slug via runWithCardSlugLookup, nunca de parâmetro nenhum que
 * o visitante controlaria). Fora de (dashboard) de propósito — não herda
 * layout/nav do CRM, o visitante nunca vê interface interna nenhuma.
 *
 * `?src=` (qr/whatsapp/instagram/direct/...) alimenta DigitalCardEvent.source
 * — pedido explícito de comparar origem de acesso depois.
 */
export default async function DigitalCardPublicPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ src?: string }>;
}) {
  const { slug } = await params;
  const { src } = await searchParams;
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  const { ok, organizationId, cardId } = await requireDigitalCard(slug, ip);

  if (!ok || !organizationId || !cardId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0b10] px-6 text-center">
        <div>
          <p className="text-lg font-semibold text-white">Cartão não encontrado</p>
          <p className="mt-1 text-sm text-white/50">Esse link pode estar errado, ou o cartão ainda não foi ativado.</p>
        </div>
      </div>
    );
  }

  const card = await runWithTenant(organizationId, async () => {
    const details = await getCardDetails(cardId);
    // Fire-and-forget — nunca atrasa a renderização da página por causa de
    // uma métrica (mesmo espírito do lastUsedAt da TV, ver require-tv-link.ts).
    recordCardEvent(organizationId, cardId, "CARD_VIEW", { source: src ?? "direct" }).catch(() => {});
    return details;
  });

  if (!card) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0b10] px-6 text-center">
        <div>
          <p className="text-lg font-semibold text-white">Cartão não encontrado</p>
        </div>
      </div>
    );
  }

  const data: DigitalCardData = {
    slug,
    displayName: card.displayName,
    jobTitle: card.jobTitle,
    companyName: card.companyName,
    bio: card.bio,
    photoUrl: card.photoUrl,
    phone: displayPhone(card.phone),
    whatsapp: displayPhone(card.whatsapp),
    displayEmail: card.displayEmail,
    address: card.address,
    showPortfolioValue: card.showPortfolioValue,
    portfolioValueDisplay: card.portfolioValueDisplay,
    links: card.links.map((l) => ({ id: l.id, type: l.type, label: l.label, url: l.url })),
    publicUrl: publicCardUrlFromHeaders(slug, hdrs),
  };

  return (
    <div className="min-h-screen bg-[#0a0b10] px-4 py-10">
      <DigitalCardView data={data} source={src ?? null} />
    </div>
  );
}
