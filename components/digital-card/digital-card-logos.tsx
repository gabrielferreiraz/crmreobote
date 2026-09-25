import { ReoboteLogo } from "@/components/reobote-logo";
import { getActivePartnerLogos } from "@/lib/digital-cards/logos";

/**
 * Fileira / Grade de logos parceiras (reordenável pelo usuário no painel).
 * Se `selectedLogos` for passado, renderiza exatamente as logos na ordem solicitada.
 * Se o arquivo da logo ainda não existir (`src: null`), exibe um badge vetorial
 * de alta resolução elegante com a marca.
 */
const LOGO_STYLE_MAP: Record<string, string> = {
  reobote: "h-5 w-auto object-contain opacity-95",
  rodobens: "h-4 w-auto max-w-[82px] object-contain opacity-90",
  yamaha: "h-4 w-auto max-w-[70px] object-contain opacity-90",
  servopa: "h-6 w-auto max-w-[100px] object-contain opacity-90",
};

export function DigitalCardLogos({
  selectedLogos,
  excludeReobote,
  light = false,
}: {
  selectedLogos?: string[];
  excludeReobote?: boolean;
  light?: boolean;
}) {
  let logos = getActivePartnerLogos(selectedLogos);
  if (excludeReobote) {
    logos = logos.filter((l) => l.key !== "reobote");
  }
  if (logos.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 py-1 px-2">
      {logos.map((logo) => {
        if (logo.src === "reobote") {
          return <ReoboteLogo key={logo.key} isLight={light} className="h-9 sm:h-10 w-auto opacity-95" aria-label={logo.label} />;
        }

        if (logo.src) {
          const styleClass = LOGO_STYLE_MAP[logo.key] ?? "h-5 w-auto max-w-[90px] object-contain opacity-90";
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={logo.key}
              src={logo.src}
              alt={logo.label}
              className={`${styleClass} transition-all hover:opacity-100 ${
                light ? "brightness-0 opacity-80" : ""
              }`}
            />
          );
        }

        // Vector badge estilizado para logos ativas que ainda aguardam o arquivo SVG
        return (
          <div
            key={logo.key}
            className="flex items-center gap-1 rounded-md border border-white/15 bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold tracking-wider text-white/80 uppercase backdrop-blur-sm shadow-sm"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#00aeee]/70" />
            <span>{logo.label}</span>
          </div>
        );
      })}
    </div>
  );
}
