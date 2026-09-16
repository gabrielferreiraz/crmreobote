import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireDigitalCard } from "@/lib/require-digital-card";
import { runWithTenant } from "@/lib/tenant-context";
import { getCardDetails, displayPhone } from "@/lib/digital-cards/queries";
import { recordCardEvent } from "@/lib/digital-cards/events";
import { publicCardUrlFromHeaders } from "@/lib/digital-cards/public-url";
import { DigitalCardView, type DigitalCardData } from "@/components/digital-card/digital-card-view";

export const dynamic = "force-dynamic";

// Sem isto, esta página herdava o manifest.ts do app inteiro (o PWA do CRM,
// start_url: "/", scope: "/" — ver app/manifest.ts). O Chrome detecta esse
// manifesto linkado e, ao "Adicionar à tela inicial", instala um atalho
// estilo PWA que abre no start_url do MANIFESTO (a raiz do CRM, "/") em vez
// de simplesmente marcar a URL exata que a pessoa visitou — é por isso que
// o atalho criado a partir do Cartão de Visita caía direto no "Início" do
// CRM (e a sessão de login, compartilhada no domínio pai
// .reoboteconsorcios.com.br, deixava passar direto sem pedir login de
// novo). `manifest: null` aqui cancela a herança (metadata é "shallow
// merged" por segmento — um valor definido no segmento mais específico
// substitui o do pai, ver node_modules/next/dist/docs/.../generate-metadata.md
// #overwriting-fields) — o Chrome passa a tratar isto como uma página comum,
// sem manifesto, e o atalho vira um bookmark de verdade da URL exata
// (?qr=1 incluso). Atalhos já criados no celular ANTES desta correção
// continuam apontando pro comportamento antigo — precisam ser apagados e
// recriados.
export const metadata: Metadata = {
  manifest: null,
};

/**
 * Página pública (sem login) do Cartão Digital — mesma família de
 * `/t/[code]` (ver lib/require-digital-card.ts, que resolve organizationId
 * a partir do slug via runWithCardSlugLookup, nunca de parâmetro nenhum que
 * o visitante controlaria). Fora de (dashboard) de propósito — não herda
 * layout/nav do CRM, o visitante nunca vê interface interna nenhuma.
 *
 * `?src=` (qr/whatsapp/instagram/direct/...) alimenta DigitalCardEvent.source
 * — pedido explícito de comparar origem de acesso depois.
 *
 * `?qr=1` — atalho "Cartão de visita" do menu do usuário (ver
 * components/user-menu.tsx): pedido explícito "ir direto na Landing Page e
 * abrir suavemente o QR Code pro consultor mostrar" — o consultor cria um
 * atalho do Chrome pro celular apontando pra cá, então basta tocar o
 * atalho e o QR já aparece, sem precisar achar o botão na tela.
 *
 * `?pid=` — id de uma DigitalCardPresentation em andamento (ver
 * qr-code-panel.tsx/usePresentationSession) — só existe quando ESTE
 * carregamento veio de alguém escaneando o QR mostrado pelo consultor em
 * "Meu QR Code" dentro do CRM. Repassado só pra correlacionar cliques
 * (whatsappClicked/vcardDownloaded/instagramClicked no schema) com essa
 * apresentação específica — nunca usado pra autenticar nada (o acesso ao
 * cartão em si já foi resolvido acima, por slug).
 */
export default async function DigitalCardPublicPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ src?: string; qr?: string; pid?: string }>;
}) {
  const { slug } = await params;
  const { src, qr, pid } = await searchParams;
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
    coverPhotoUrl: card.coverPhotoUrl,
    backgroundPhotoUrl: card.backgroundPhotoUrl,
    phone: displayPhone(card.phone),
    whatsapp: displayPhone(card.whatsapp),
    displayEmail: card.displayEmail,
    address: card.address,
    showPortfolioValue: card.showPortfolioValue,
    portfolioValueDisplay: card.portfolioValueDisplay,
    selectedLogos: card.selectedLogos,
    links: card.links.map((l) => ({ id: l.id, type: l.type, label: l.label, url: l.url })),
    publicUrl: publicCardUrlFromHeaders(slug, hdrs),
  };

  return (
    <div className="min-h-screen bg-[#090d16] sm:bg-[#0a0b10] sm:px-4 sm:py-8 flex justify-center">
      <div className="w-full max-w-md min-h-screen sm:min-h-0">
        <DigitalCardView data={data} source={src ?? null} autoOpenQr={qr === "1"} presentationId={pid ?? null} />
      </div>
    </div>
  );
}
