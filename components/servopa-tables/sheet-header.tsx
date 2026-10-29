import { ReoboteLogo } from "@/components/reobote-logo";
import { ServopaLogo, ServopaSeal } from "@/components/servopa-tables/servopa-brand";

/**
 * Cabeçalho da folha do PDF. Usado pela própria folha (print-sheet.tsx) e pela
 * prévia da tela de campanhas, para a prévia ser exatamente o que sai no PDF.
 */

/** Logo Servopa + "Parceira Autorizada", GRUPO/MESES e o selo — `light` = texto branco sobre a arte da campanha. */
export function SheetTitle({ groupNumber, termMonths, tone }: { groupNumber: string; termMonths: number; tone: "light" | "dark" }) {
  return (
    <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
      <div className="inline-flex flex-col items-center justify-self-start">
        <ServopaLogo />
        <p className={`mt-[1.2mm] whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.2em] ${tone === "light" ? "text-white/85" : "text-neutral-500"}`}>Parceira Autorizada</p>
      </div>
      <div className="text-center">
        <p className="whitespace-nowrap text-[22px] font-bold leading-tight tracking-tight">GRUPO {groupNumber}</p>
        <p className={`mt-0.5 whitespace-nowrap text-[14px] font-bold ${tone === "light" ? "text-white" : "text-neutral-800"}`}>{termMonths} MESES</p>
      </div>
      <div className="flex justify-end">
        <ServopaSeal />
      </div>
    </header>
  );
}

/**
 * Faixa da campanha: 52 mm de altura, arte de fundo cortada para cobrir
 * (centrada) e logos/texto por cima. Na folha, a largura vem das margens
 * negativas (.servopa-campaign-band em print-sheet.tsx); na prévia, de `className`.
 */
export function CampaignBand({
  artUrl,
  textColor,
  groupNumber,
  termMonths,
  campaignName,
  className = "",
}: {
  artUrl: string;
  textColor: "WHITE" | "BLACK";
  groupNumber: string;
  termMonths: number;
  campaignName?: string;
  className?: string;
}) {
  const white = textColor === "WHITE";
  return (
    <div
      className={`servopa-campaign-band relative h-[52mm] overflow-hidden text-[13.5px] leading-snug ${white ? "text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.45)]" : "text-neutral-900"} ${className}`}
      data-campaign={campaignName}
    >
      {/* <img> comum (não next/image): o "Baixar PDF" espera as <img> da folha carregarem antes de fotografar. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={artUrl} alt="" className="absolute inset-0 h-full w-full object-cover object-center" />
      <div className="servopa-campaign-content relative flex h-full flex-col justify-center px-[12mm]">
        <div className={`mb-[4mm] flex justify-center border-b pb-[2.5mm] ${white ? "border-white/35" : "border-neutral-900/20"}`}>
          <ReoboteLogo isLight={!white} className="h-[14mm] w-auto" />
        </div>
        <SheetTitle groupNumber={groupNumber} termMonths={termMonths} tone={white ? "light" : "dark"} />
      </div>
    </div>
  );
}
