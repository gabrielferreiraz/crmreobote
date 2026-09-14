import { ReoboteLogo } from "@/components/reobote-logo";
import { getActivePartnerLogos } from "@/lib/digital-cards/logos";

/**
 * Fileira de logos parceiras (pedido: Reobote → Rodobens → Yamaha →
 * Servopa) — itera sobre PARTNER_LOGOS (lib/digital-cards/logos.ts), nunca
 * hardcoded aqui. Uma logo com `src: null` (arquivo ainda não enviado)
 * simplesmente não aparece — nunca quebra o layout nem mostra um
 * placeholder falso.
 */
export function DigitalCardLogos() {
  const logos = getActivePartnerLogos().filter((l) => l.src !== null);
  if (logos.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 py-1">
      {logos.map((logo) =>
        logo.src === "reobote" ? (
          <ReoboteLogo key={logo.key} className="h-4 w-auto opacity-90" aria-label={logo.label} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={logo.key} src={logo.src!} alt={logo.label} className="h-5 w-auto object-contain opacity-90" />
        ),
      )}
    </div>
  );
}
