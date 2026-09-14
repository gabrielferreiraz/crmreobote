"use client";

import { User as UserIcon } from "lucide-react";
import { ReoboteLogo } from "@/components/reobote-logo";
import { DigitalCardLogos } from "./digital-card-logos";
import { DigitalCardActions } from "./digital-card-actions";
import { DigitalCardContactActions } from "./digital-card-contact-actions";
import { DigitalCardLinks } from "./digital-card-links";
import { useCardTracking } from "@/lib/digital-cards/use-card-tracking";

export type DigitalCardData = {
  slug: string;
  displayName: string;
  jobTitle: string | null;
  companyName: string | null;
  bio: string | null;
  photoUrl: string | null;
  phone: string | null;
  whatsapp: string | null;
  displayEmail: string | null;
  address: string | null;
  showPortfolioValue: boolean;
  portfolioValueDisplay: string | null;
  links: { id: string; type: string; label: string; url: string }[];
  publicUrl: string;
};

/**
 * Composição visual do cartão — reaproveitada TANTO pela página pública
 * (app/c/[slug]/page.tsx) QUANTO pelo preview ao vivo em "Meu Cartão" (ver
 * plano: pedido explícito de preview antes de publicar). `interactive`
 * desliga o tracking de clique no modo preview (o próprio dono navegando
 * pelo preview não deveria contar como visita/clique de verdade).
 *
 * Estrutura (capa + avatar sobrepondo a borda, fileira de ícones de
 * contato, pills grandes de telefone/WhatsApp) segue a hierarquia visual
 * de referência que o usuário pediu pra imitar (Taggo) — mas a IDENTIDADE é
 * só da Reobote: cor de marca real (#00aeee, mesma do logo — ver
 * components/reobote-logo.tsx), sem o selo de "verificado" (não existe esse
 * conceito aqui) e sem nenhum texto/branding do produto de referência.
 */
export function DigitalCardView({
  data,
  source,
  interactive = true,
}: {
  data: DigitalCardData;
  source?: string | null;
  interactive?: boolean;
}) {
  const { track, sessionId } = useCardTracking(data.slug, source ?? null, null);
  const onTrack = interactive ? track : () => {};

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="overflow-hidden rounded-3xl bg-[#0a0b10] text-center shadow-2xl ring-1 ring-white/10">
        {/* Capa — abstrata (nunca uma foto inventada), com um brilho radial
            simulando profundidade/atmosfera atrás do avatar, mais alta e
            com mais presença (pedido: "mais parecido" com a referência). */}
        <div className="relative h-36 overflow-hidden bg-gradient-to-br from-[#0e3a52] via-[#132038] to-[#0a0b10]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(0,174,238,0.35),transparent_60%)]" />
        </div>

        <div className="relative -mt-16 px-6 pb-0">
          {/* Foto — puxada por cima da costura entre a capa e o corpo do cartão, maior (mesma proporção da referência). */}
          <div className="mx-auto mb-4 h-28 w-28 overflow-hidden rounded-full ring-[6px] ring-[#0a0b10]">
            {data.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.photoUrl} alt={data.displayName} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-white/10">
                <UserIcon className="h-10 w-10 text-white/40" strokeWidth={1.5} />
              </div>
            )}
          </div>

          {/* Nome / cargo */}
          <h1 className="text-lg font-semibold tracking-tight text-white">{data.displayName}</h1>
          {data.jobTitle && <p className="mt-0.5 text-sm font-medium text-[#00aeee]">{data.jobTitle}</p>}
          {data.companyName && <p className="mt-0.5 text-xs text-white/40">{data.companyName}</p>}

          {/* Logos parceiras */}
          <div className="mt-5">
            <DigitalCardLogos />
          </div>

          {/* Ações principais */}
          <div className="mt-5">
            <DigitalCardActions
              slug={data.slug}
              displayName={data.displayName}
              publicUrl={data.publicUrl}
              sessionId={sessionId}
              source={source ?? null}
              onTrack={onTrack}
            />
          </div>

          {/* Contato — fileira de ícones + pills grandes de telefone/WhatsApp */}
          <div className="mt-5">
            <DigitalCardContactActions
              phone={data.phone}
              whatsapp={data.whatsapp}
              email={data.displayEmail}
              address={data.address}
              onTrack={onTrack}
            />
          </div>

          {/* Bio */}
          {data.bio && <p className="mt-5 text-sm leading-relaxed text-white/70">{data.bio}</p>}

          {/* Valor em carteira — só se ligado explicitamente */}
          {data.showPortfolioValue && data.portfolioValueDisplay && (
            <div className="mt-5 rounded-xl border border-[#00aeee]/25 bg-[#00aeee]/[0.07] px-4 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-white/40">Carteira sob gestão</p>
              <p className="mt-0.5 text-sm font-semibold text-white">{data.portfolioValueDisplay}</p>
            </div>
          )}

          {/* Links adicionais */}
          {data.links.length > 0 && (
            <div className="mt-5">
              <DigitalCardLinks links={data.links} onTrack={onTrack} />
            </div>
          )}
        </div>

        {/* Rodapé — barra própria (não só texto solto), mesma ideia de peso
            visual da referência, com a marca real da Reobote. */}
        <div className="mt-6 flex items-center justify-center gap-2 border-t border-white/10 bg-white/[0.03] px-6 py-3.5">
          <ReoboteLogo className="h-3 w-auto opacity-60" />
          <span className="text-[11px] text-white/40">Cartão Digital</span>
        </div>
      </div>
    </div>
  );
}
