"use client";

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
        className={`relative w-full overflow-hidden rounded-none sm:rounded-[2.2rem] min-h-dvh sm:min-h-0 shadow-none sm:shadow-[0_20px_50px_rgba(0,0,0,0.7)] ${
          isLight
            ? "bg-[#eaf4fb]/95 text-slate-800 ring-0 sm:ring-1 sm:ring-sky-200/60"
            : "bg-[#090d16] text-white ring-0 sm:ring-1 sm:ring-white/10"
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
          <div className="absolute inset-0 bg-gradient-to-b from-[#f3f9fd]/90 via-[#e1f0fa]/85 to-[#d3e9f7]/95" />
        ) : isPhoto ? (
          data.backgroundPhotoUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data.backgroundPhotoUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
              {/* Scrim escuro leve para garantir contraste do texto branco sem tampar a foto */}
              <div className="absolute inset-0 bg-black/45" />
            </>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-b from-[#0c2a4a] via-[#09152a] to-[#090d16]" />
          )
        ) : data.backgroundPhotoUrl ? (
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
            com um filtro por cima, não é opcional: o nome/cargo
            ficam em cima dela e precisam de contraste garantido, ver
            lib/digital-cards/config.ts pro porquê disso ficar null por
            enquanto). Sem foto nenhuma, cai pro gradiente abstrato + efeitos
            de luz — azul translúcido no tema claro, escuro nos outros. */}
        <div
          className={`relative overflow-hidden ${
            isLight
              ? "bg-gradient-to-br from-[#cce4f7] via-[#bfe0f7] to-[#e4f2fc]"
              : "bg-gradient-to-br from-[#0c2a4a] via-[#0f1b33] to-[#08090e]"
          } ${data.coverPhotoUrl ? "w-full aspect-[1.6/1] min-h-[220px]" : "h-48"}`}
        >
          {data.coverPhotoUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data.coverPhotoUrl} alt="" className="h-full w-full object-cover" />
              {/* Transição em degradê suave que escurece/clareia gradualmente até a altura do nome do contato */}
              <div
                className={`absolute inset-0 bg-gradient-to-b ${
                  isLight
                    ? "from-white/0 via-white/20 via-50% to-[#eaf4fb]"
                    : "from-black/0 via-black/25 via-50% to-[#090d16]"
                }`}
              />
            </>
          ) : isLight ? (
            <>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_25%,rgba(0,174,238,0.35),transparent_75%)]" />
              <div className="absolute -top-10 -right-10 h-44 w-44 rounded-full bg-[#00aeee]/20 blur-2xl" />
              <div className="absolute -bottom-10 -left-10 h-44 w-44 rounded-full bg-cyan-300/30 blur-2xl" />
            </>
          ) : (
            <>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_25%,rgba(0,174,238,0.45),transparent_75%)]" />
              <div className="absolute -top-10 -right-10 h-44 w-44 rounded-full bg-[#00aeee]/25 blur-2xl" />
              <div className="absolute -bottom-10 -left-10 h-44 w-44 rounded-full bg-blue-600/25 blur-2xl" />
              {/* Padrão geométrico abstrato sutil */}
              <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:16px_16px]" />
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/20 to-[#090d16]" />
            </>
          )}
        </div>

        <div className={`relative px-4.5 pb-0 ${data.coverPhotoUrl ? "-mt-36" : "-mt-28"}`}>
          {/* Avatar com Anel de Brilho em Gradiente Neon */}
          <div className="relative mx-auto mb-4 h-44 w-44">
            <div
              className={`h-full w-full overflow-hidden rounded-full p-[3px] transition-transform duration-300 hover:scale-105 ${
                isLight
                  ? "bg-gradient-to-tr from-[#00aeee] via-sky-400 to-white shadow-[0_0_24px_rgba(0,174,238,0.35)]"
                  : "bg-gradient-to-tr from-[#00aeee] via-cyan-400 to-blue-600 shadow-[0_0_24px_rgba(0,174,238,0.5)]"
              }`}
            >
              <div
                className={`h-full w-full overflow-hidden rounded-full ${
                  isLight ? "bg-white ring-4 ring-[#eaf4fb]" : "bg-[#090d16]"
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
          <h1 className={`text-xl font-extrabold tracking-tight ${isLight ? "text-slate-900" : "text-white"}`}>
            {data.displayName}
          </h1>

          {data.jobTitle && (
            <div
              className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full px-3.5 py-0.5 text-sm font-semibold ${
                isLight
                  ? "border border-[#00aeee]/40 bg-[#00aeee]/15 text-[#007ea8] shadow-[0_2px_8px_rgba(0,174,238,0.12)]"
                  : "border border-[#00aeee]/30 bg-[#00aeee]/15 text-[#00aeee] shadow-[0_2px_10px_rgba(0,174,238,0.15)]"
              }`}
            >
              {data.jobTitle}
            </div>
          )}

          {data.companyName && (
            <p className={`mt-1 text-sm font-medium ${isLight ? "text-slate-600" : "text-white/50"}`}>
              {data.companyName}
            </p>
          )}

          {/* Logo da Reobote — pedido explícito: maior, mais legível/destacada. No tema claro, a parte branca vira navy via CSS. */}
          <div className="mt-5 flex justify-center px-4">
            <ReoboteLogo
              className={`h-24 sm:h-28 w-auto opacity-95 ${
                isLight ? "[&_path[fill='#ffffff']]:fill-[#0b213b] [&_path[fill='white']]:fill-[#0b213b]" : ""
              }`}
            />
          </div>

          {/* Logos parceiras (Rodobens, Yamaha, Servopa, etc.) */}
          <div className="mt-3">
            <DigitalCardLogos selectedLogos={data.selectedLogos} excludeReobote light={isLight} />
          </div>

          {/* Valor em carteira */}
          {data.showPortfolioValue && data.portfolioValueDisplay && (
            <div className="mt-5 flex flex-col items-center">
              <p
                className={`text-[11px] font-bold uppercase tracking-[0.2em] ${
                  isLight ? "text-slate-500" : "text-white/50"
                }`}
              >
                Carteira sob gestão
              </p>
              <p
                className={`mt-0.5 text-xl font-black drop-shadow-md ${
                  isLight
                    ? "bg-gradient-to-r from-[#008fcc] via-cyan-600 to-[#008fcc] bg-clip-text text-transparent"
                    : "bg-gradient-to-r from-[#00aeee] via-cyan-300 to-[#00aeee] bg-clip-text text-transparent"
                }`}
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
            <div className="mt-3 px-2 text-center">
              <p
                className={`text-sm font-medium italic leading-relaxed tracking-wide ${
                  isLight ? "text-slate-700" : "text-white/85"
                }`}
              >
                “{data.bio}”
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
              ? "border-sky-200/60 bg-white/40 text-slate-500 [&_path[fill='#ffffff']]:fill-[#0b213b]"
              : "border-white/10 bg-white/[0.02] text-white/40"
          }`}
        >
          <ReoboteLogo className="h-3.5 w-auto opacity-75" />
          <span className="text-xs font-medium">Cartão Digital</span>
        </div>
        </div>
      </div>
    </div>
  );
}
