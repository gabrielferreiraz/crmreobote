import Link from "next/link";
import { Pencil } from "lucide-react";
import { DigitalCardView, type DigitalCardData } from "@/components/digital-card/digital-card-view";
import { PhonePreviewFrame } from "@/components/digital-card/phone-preview-frame";
import { displayPhone } from "@/lib/phone-normalize";
import { QrCodePanel } from "./qr-code-panel";
import { CardStats } from "./card-stats";
import type { getOrCreateOwnCard, CardStats as CardStatsData } from "@/lib/digital-cards/queries";

type Card = NonNullable<Awaited<ReturnType<typeof getOrCreateOwnCard>>>;

/**
 * Modo "mostrar" — atalho "Cartão de visita" no menu do usuário (ver
 * components/user-menu.tsx), pra quem já quer APRESENTAR o cartão na hora
 * ("ali deve mostrar já como está configurado, como se ele quisesse
 * mostrar já" — pedido explícito), sem passar pelo formulário de edição.
 * Mostra o cartão exatamente como está salvo agora (sem estado local
 * editável, diferente de card-editor.tsx) + já abre "Meu QR Code" sozinho.
 * Editar continua só em Configurações → Cartão Digital (pedido explícito:
 * "a configuração deve ainda manter e lá dentro de configurações aí sim
 * editar") — aqui só um link pra lá, nunca os campos de formulário.
 */
export function CardQuickView({ card, stats, publicUrl }: { card: Card; stats: CardStatsData; publicUrl: string }) {
  if (!card.active) {
    return (
      <div className="card mx-auto max-w-md space-y-3 p-6 text-center">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Seu cartão ainda não está ativo</p>
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          Configure e ative seu Cartão Digital antes de poder apresentá-lo.
        </p>
        <Link href="/configuracoes/meu-cartao" className="btn-primary btn-sm mx-auto w-fit">
          <Pencil className="h-3.5 w-3.5" strokeWidth={2.3} />
          Configurar cartão
        </Link>
      </div>
    );
  }

  const data: DigitalCardData = {
    slug: card.slug,
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
    links: card.links.map((l) => ({ id: l.id, type: l.type, label: l.label, url: l.url })),
    publicUrl,
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Seu Cartão de Visita</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Pronto pra apresentar — como está configurado agora.</p>
        </div>
        <Link href="/configuracoes/meu-cartao" className="btn-secondary btn-sm shrink-0">
          <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
          Editar
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_345px] lg:items-start">
        <div className="space-y-4">
          <div className="card p-4">
            <QrCodePanel cardId={card.id} publicUrl={publicUrl} autoOpen />
          </div>
          <div className="card p-4">
            <CardStats stats={stats} />
          </div>
        </div>

        <div className="select-none">
          <PhonePreviewFrame>
            <DigitalCardView data={data} interactive={false} />
          </PhonePreviewFrame>
        </div>
      </div>
    </div>
  );
}
