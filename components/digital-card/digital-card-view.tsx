"use client";

import { useState, useEffect } from "react";
import { User as UserIcon } from "lucide-react";
import { ReoboteLogo } from "@/components/reobote-logo";
import { DigitalCardLogos } from "./digital-card-logos";
import { DigitalCardActions } from "./digital-card-actions";
import { DigitalCardContactActions } from "./digital-card-contact-actions";
import { DigitalCardLinks } from "./digital-card-links";
import { useCardTracking } from "@/lib/digital-cards/use-card-tracking";
import type { CardTheme } from "@/lib/digital-cards/themes";

export type DigitalCardData = {
  slug: string;
  displayName: string;
  jobTitle: string | null;
  companyName: string | null;
  bio: string | null;
  photoUrl: string | null;
  coverPhotoUrl: string | null;
  coverPhotoUrls?: string[];
  backgroundPhotoUrl: string | null;
  phone: string | null;
  whatsapp: string | null;
  displayEmail: string | null;
  address: string | null;
  showPortfolioValue: boolean;
  portfolioValueDisplay: string | null;
  selectedLogos?: string[];
  links: { id: string; type: string; label: string; url: string }[];
  publicUrl: string;
  /**
   * Tema visual — "DARK" | "LIGHT" | "PHOTO".
   * - DARK: visual escuro premium de sempre (#090d16)
   * - LIGHT: azul bem claro e quase transparente (glassmorphism translúcido), texto escuro
   * - PHOTO: foto cobrindo o cartão inteiro com scrim escuro leve (foto em destaque, texto branco)
   */
  theme?: CardTheme;
};

function CoverCarousel({ urls, isLight }: { urls: string[]; isLight: boolean }) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (urls.length <= 1) return;
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % urls.length);
    }, 4500);
    return () => clearInterval(interval);
  }, [urls.length]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      {urls.map((url, idx) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={url}
          src={url}
          alt=""
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ease-in-out ${
            idx === activeIndex ? "opacity-100 z-0" : "opacity-0 -z-10"
          }`}
        />
      ))}
      {/* Sombra muito leve apenas no topo para contraste dos botões/bullets se necessário */}
      <div
        className={`absolute inset-0 z-10 bg-gradient-to-b ${
          isLight
            ? "from-black/15 via-transparent to-transparent"
            : "from-black/25 via-transparent to-transparent"
        }`}
      />
      {/* Indicadores discretos de página (bullets/tracinhos) no topo direito */}
      {urls.length > 1 && (
        <div className="absolute top-2.5 right-3 z-20 flex items-center gap-1.5 rounded-full bg-black/45 px-2 py-1 backdrop-blur-md border border-white/10 shadow-sm">
          {urls.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setActiveIndex(idx)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                idx === activeIndex ? "w-4 bg-[#00aeee]" : "w-1.5 bg-white/40 hover:bg-white/80"
              }`}
              title={`Foto ${idx + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

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
  autoOpenQr = false,
  presentationId = null,
}: {
  data: DigitalCardData;
  source?: string | null;
  interactive?: boolean;
  autoOpenQr?: boolean;
  /** `?pid=` — ver comentário em app/c/[slug]/page.tsx. Correlaciona
   * cliques com uma DigitalCardPresentation em andamento; null no caso
   * comum (acesso direto/link/QR "solto" da própria página, sem passar
   * pelo fluxo de "Meu QR Code"). */
  presentationId?: string | null;
}) {
  const theme = data.theme ?? "DARK";
  const isLight = theme === "LIGHT";
  const isPhoto = theme === "PHOTO";

  const { track, sessionId } = useCardTracking(data.slug, source ?? null, presentationId);
  const onTrack = interactive ? track : () => {};

  return (
    <div
      className={`mx-auto w-full max-w-full overflow-x-hidden ${
        !interactive ? "[&_a]:pointer-events-none [&_button]:pointer-events-none" : ""
      }`}
    >
      {/* min-h-dvh (não min-h-screen) — no Safari iOS, 100vh conta a área
          por trás da barra de endereço/toolbar dinâmica, deixando uma
          sobra de espaço em branco embaixo enquanto ela está expandida;
          dvh (dynamic viewport height) já desconta isso. */}
      <div
        className={`relative w-full overflow-hidden rounded-none sm:rounded-[1.5rem] min-h-dvh sm:min-h-0 shadow-none sm:shadow-[0_20px_50px_rgba(0,0,0,0.45)] ${
          isLight
            ? "bg-[#e8eef4] text-slate-900 ring-0 sm:ring-1 sm:ring-slate-200"
            : "bg-[#151a22] text-white ring-0 sm:ring-1 sm:ring-white/10"
        }`}
      >
        {/* ─── Fundo do CORPO INTEIRO do cartão ───────────────────────────
            - LIGHT: azul bem claro, gradiente sutil e quase transparente
              (estilo glassmorphism), foto de fundo omitida.
            - PHOTO: foto de fundo cobrindo o cartão inteiro com scrim escuro
              LEVE por cima (sem o degradê pesado de antes) — texto branco legível.
            - DARK: comportamento de sempre (se tiver foto, gradiente escuro de
              cima a baixo; se não tiver, fundo sólido #090d16). */}
        {isLight ? (
          <div className="absolute inset-0 bg-[#e8eef4]" />
        ) : isPhoto ? (
          data.backgroundPhotoUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data.backgroundPhotoUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
              {/* Scrim escuro leve para garantir contraste do texto branco sem tampar a foto */}
              <div className="absolute inset-0 bg-black/45" />
            </>
          ) : (
            <div className="absolute inset-0 bg-[#151a22]" />
          )
        ) : data.backgroundPhotoUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={data.backgroundPhotoUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-black/55" />
          </>
        ) : (
          <div className="absolute inset-0 bg-[#151a22]" />
        )}

        <div className="relative z-10 text-center">
        {/* Capa — foto própria/padrão da organização quando existir (SEMPRE
            com um filtro por cima, não é opcional: o nome/cargo
            ficam em cima dela e precisam de contraste garantido, ver
            lib/digital-cards/config.ts pro porquê disso ficar null por
            enquanto). Sem foto nenhuma, cai pro gradiente abstrato + efeitos
            de luz — azul translúcido no tema claro, escuro nos outros. */}
        <div
          className={`relative overflow-hidden ${
            isLight
              ? "bg-[#dce8f1]"
              : "bg-[#10151d]"
          } ${data.coverPhotoUrl ? "w-full aspect-[1.6/1] min-h-[200px]" : "h-40"}`}
        >
          {data.coverPhotoUrls && data.coverPhotoUrls.length > 0 ? (
            <CoverCarousel urls={data.coverPhotoUrls} isLight={isLight} />
          ) : data.coverPhotoUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data.coverPhotoUrl} alt="" className="h-full w-full object-cover" />
              {/* Transição em degradê suave que escurece/clareia gradualmente até a altura do nome do contato */}
              <div
                className={`absolute inset-0 bg-gradient-to-b ${
                  isLight
                    ? "from-black/15 via-transparent to-transparent"
                    : "from-black/25 via-transparent to-transparent"
                }`}
              />
            </>
          ) : null}
        </div>

        <div
          className={`relative -mt-16 rounded-t-[1.5rem] border-t px-5 pb-0 pt-5 shadow-[0_-12px_28px_rgba(0,0,0,0.12)] ${
            isLight ? "border-white/70 bg-[#e8eef4]" : "border-white/[0.07] bg-[#151a22]"
          }`}
        >
          {/* Avatar com Anel de Brilho em Gradiente Neon */}
          <div className="relative z-30 mx-auto -mt-20 mb-4 h-28 w-28">
            <div
              className={`h-full w-full overflow-hidden rounded-full border p-1 shadow-[0_10px_20px_rgba(0,0,0,0.3)] transition-transform duration-300 hover:scale-105 ${
                isLight
                  ? "border-white bg-[#f7fbff]"
                  : "border-white/15 bg-[#222936]"
              }`}
            >
              <div
                className={`h-full w-full overflow-hidden rounded-full ${
                  isLight ? "bg-white" : "bg-[#151a22]"
                }`}
              >
                {data.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={data.photoUrl} alt={data.displayName} className="h-full w-full object-cover" />
                ) : (
                  <div className={`flex h-full w-full items-center justify-center ${isLight ? "bg-sky-100" : "bg-white/10"}`}>
                    <UserIcon className={`h-12 w-12 ${isLight ? "text-sky-600/60" : "text-white/50"}`} strokeWidth={1.5} />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Nome e Info Principal */}
          <h1 className={`text-xl font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
            {data.displayName}
          </h1>

          {data.jobTitle && (
            <p className={`mt-1 text-sm ${isLight ? "text-slate-600" : "text-white/65"}`}>
              {data.jobTitle}
            </p>
          )}

          {data.companyName && (
            <p className={`mt-0.5 text-sm ${isLight ? "text-slate-500" : "text-white/45"}`}>
              {data.companyName}
            </p>
          )}

          {/* Logo da Reobote — pedido explícito: maior, mais legível/destacada. No tema claro, a parte branca vira navy/escuro via isLight prop. */}
          <div className="mt-4 flex justify-center px-4">
            <ReoboteLogo isLight={isLight} className="h-15 w-auto opacity-90" />
          </div>

          {/* Logos parceiras (Rodobens, Yamaha, Servopa, etc.) */}
          <div className="mt-3">
            <DigitalCardLogos selectedLogos={data.selectedLogos} excludeReobote light={isLight} />
          </div>

          {/* Valor em carteira */}
          {data.showPortfolioValue && data.portfolioValueDisplay && (
            <div
              className={`mt-4 flex flex-col items-center rounded-lg border px-4 py-3 shadow-[0_7px_16px_rgba(0,0,0,0.16),inset_0_1px_0_rgba(255,255,255,0.08)] ${
                isLight ? "border-white bg-white/70" : "border-white/[0.08] bg-[#202733]"
              }`}
            >
              <p
                className={`text-[11px] font-bold uppercase tracking-[0.2em] ${
                  isLight ? "text-slate-500" : "text-white/50"
                }`}
              >
                Carteira sob gestão
              </p>
              <p
                className={`mt-0.5 text-xl font-bold ${isLight ? "text-[#007ea8]" : "text-[#63c9f2]"}`}
              >
                {data.portfolioValueDisplay}
              </p>
            </div>
          )}

          {/* Ações principais */}
          <div className="mt-4">
            <DigitalCardActions
              slug={data.slug}
              displayName={data.displayName}
              publicUrl={data.publicUrl}
              sessionId={sessionId}
              source={source ?? null}
              presentationId={presentationId}
              onTrack={onTrack}
              autoOpenQr={interactive && autoOpenQr}
              light={isLight}
            />
          </div>

          {/* Contato */}
          <div className="mt-4">
            <DigitalCardContactActions
              whatsapp={data.whatsapp}
              email={data.displayEmail}
              address={data.address}
              instagram="reoboteconsorcios"
              onTrack={onTrack}
              light={isLight}
            />
          </div>

          {/* Bio (Itálico limpo sem bordas/caixa) */}
          {data.bio && (
            <div className="mt-4 px-2 text-center">
              <p
                className={`text-sm leading-relaxed ${
                  isLight ? "text-slate-700" : "text-white/85"
                }`}
              >
                {data.bio}
              </p>
            </div>
          )}

          {/* Links adicionais */}
          {data.links.length > 0 && (
            <div className="mt-4">
              <DigitalCardLinks links={data.links} onTrack={onTrack} light={isLight} />
            </div>
          )}
        </div>

        {/* Rodapé Premium */}
        <div
          className={`mt-5 flex items-center justify-center gap-2 border-t px-5 py-3 ${
            isLight
              ? "border-sky-200/60 bg-white/40 text-slate-500"
              : "border-white/10 bg-white/[0.02] text-white/40"
          }`}
        >
          <ReoboteLogo isLight={isLight} className="h-3.5 w-auto opacity-75" />
          <span className="text-xs font-medium">Cartão Digital</span>
        </div>
        </div>
      </div>
    </div>
  );
}
