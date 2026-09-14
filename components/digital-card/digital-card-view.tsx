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
  coverPhotoUrl: string | null;
  backgroundPhotoUrl: string | null;
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
    <div className={`mx-auto w-full max-w-full overflow-x-hidden ${!interactive ? "[&_a]:pointer-events-none [&_button]:pointer-events-none" : ""}`}>
      <div className="relative w-full overflow-hidden rounded-[2.2rem] shadow-[0_20px_50px_rgba(0,0,0,0.7)] ring-1 ring-white/10">
        {/* Fundo do CORPO INTEIRO do cartão (atrás de ações/ícones/bio/
            rodapé — imagem DISTINTA da capa abaixo, que fica só atrás do
            avatar) — pedido explícito: "a capa de fundo atrás do avatar e
            outra de fundo com todo o corpo do cartão" são duas imagens.
            Camada absoluta atrás de TUDO (z-10 no wrapper de conteúdo
            abaixo garante isso, independente da ordem no DOM); sem foto
            própria/padrão da organização, cai pro fundo escuro sólido de
            sempre — nunca um placeholder inventado. */}
        {data.backgroundPhotoUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={data.backgroundPhotoUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/60 to-[#090d16]" />
          </>
        ) : (
          <div className="absolute inset-0 bg-[#090d16]" />
        )}

        <div className="relative z-10 text-center">
        {/* Capa — foto própria/padrão da organização quando existir (SEMPRE
            com um filtro escuro por cima, não é opcional: o nome/cargo
            ficam em cima dela e precisam de contraste garantido, ver
            lib/digital-cards/config.ts pro porquê disso ficar null por
            enquanto). Sem foto nenhuma, cai pro gradiente abstrato + efeitos
            de luz de sempre — nunca um placeholder inventado. */}
        <div className={`relative overflow-hidden bg-gradient-to-br from-[#0c2a4a] via-[#0f1b33] to-[#08090e] ${data.coverPhotoUrl ? "h-52" : "h-36"}`}>
          {data.coverPhotoUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data.coverPhotoUrl} alt="" className="h-full w-full object-cover" />
              {/* Mais clara no topo (a foto aparece de verdade, como na
                  referência) escurecendo gradualmente até se fundir com o
                  corpo do cartão — não um filtro escuro uniforme por cima
                  de tudo. */}
              <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/35 to-[#090d16]" />
            </>
          ) : (
            <>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(0,174,238,0.45),transparent_70%)]" />
              <div className="absolute -top-10 -right-10 h-36 w-36 rounded-full bg-[#00aeee]/25 blur-2xl" />
              <div className="absolute -bottom-10 -left-10 h-36 w-36 rounded-full bg-blue-600/25 blur-2xl" />
              {/* Padrão geométrico abstrato sutil */}
              <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:16px_16px]" />
            </>
          )}
        </div>

        <div className={`relative px-4.5 pb-0 ${data.coverPhotoUrl ? "-mt-20" : "-mt-16"}`}>
          {/* Avatar com Anel de Brilho em Gradiente Neon */}
          <div className="relative mx-auto mb-3 h-26 w-26">
            <div className="h-full w-full overflow-hidden rounded-full p-[3px] bg-gradient-to-tr from-[#00aeee] via-cyan-400 to-blue-600 shadow-[0_0_22px_rgba(0,174,238,0.45)]">
              <div className="h-full w-full overflow-hidden rounded-full bg-[#090d16]">
                {data.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={data.photoUrl} alt={data.displayName} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-white/10">
                    <UserIcon className="h-10 w-10 text-white/50" strokeWidth={1.5} />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Nome e Info Principal */}
          <h1 className="text-lg font-extrabold tracking-tight text-white">{data.displayName}</h1>
          
          {data.jobTitle && (
            <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-[#00aeee]/30 bg-[#00aeee]/15 px-3.5 py-0.5 text-xs font-semibold text-[#00aeee] shadow-[0_2px_10px_rgba(0,174,238,0.15)]">
              {data.jobTitle}
            </div>
          )}
          
          {data.companyName && (
            <p className="mt-1 text-xs font-medium text-white/50">{data.companyName}</p>
          )}

          {/* Logos parceiras */}
          <div className="mt-4">
            <DigitalCardLogos />
          </div>

          {/* Ações principais */}
          <div className="mt-4">
            <DigitalCardActions
              slug={data.slug}
              displayName={data.displayName}
              publicUrl={data.publicUrl}
              sessionId={sessionId}
              source={source ?? null}
              onTrack={onTrack}
            />
          </div>

          {/* Contato */}
          <div className="mt-4">
            <DigitalCardContactActions
              phone={data.phone}
              whatsapp={data.whatsapp}
              email={data.displayEmail}
              address={data.address}
              onTrack={onTrack}
            />
          </div>

          {/* Bio */}
          {data.bio && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-xs leading-relaxed text-white/80 backdrop-blur-md">
              {data.bio}
            </div>
          )}

          {/* Valor em carteira */}
          {data.showPortfolioValue && data.portfolioValueDisplay && (
            <div className="mt-4 rounded-2xl border border-[#00aeee]/30 bg-gradient-to-r from-[#00aeee]/15 via-cyan-500/10 to-blue-600/15 p-3 text-center shadow-lg backdrop-blur-md">
              <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-300/80">Carteira sob gestão</p>
              <p className="mt-0.5 text-base font-extrabold text-white">{data.portfolioValueDisplay}</p>
            </div>
          )}

          {/* Links adicionais */}
          {data.links.length > 0 && (
            <div className="mt-4">
              <DigitalCardLinks links={data.links} onTrack={onTrack} />
            </div>
          )}
        </div>

        {/* Rodapé Premium */}
        <div className="mt-5 flex items-center justify-center gap-2 border-t border-white/10 bg-white/[0.02] px-5 py-3">
          <ReoboteLogo className="h-3 w-auto opacity-75" />
          <span className="text-[10px] font-medium text-white/40">Cartão Digital</span>
        </div>
        </div>
      </div>
    </div>
  );
}
