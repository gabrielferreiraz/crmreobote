import { Globe2, MapPin } from "lucide-react";

type Props = {
  address: string | null;
  instagram?: string | null;
  onTrack: (eventType: string) => void;
  /** Adapta a paleta dos ícones para o tema claro */
  light?: boolean;
};

/** Ícone oficial do Instagram */
function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
    </svg>
  );
}

/** Ícone circular com efeito glassmorphism e brilho temático no hover. */
function IconAction({
  icon: Icon,
  label,
  href,
  onClick,
  accentClass,
  light = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
  onClick: () => void;
  accentClass: string;
  light?: boolean;
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
      className="flex flex-col items-center gap-1.5 group"
    >
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-lg border transition-all duration-200 group-hover:-translate-y-0.5 ${
          light
            ? "border-white bg-white/75 text-slate-800 shadow-[0_5px_10px_rgba(15,23,42,0.1),inset_0_1px_0_rgba(255,255,255,0.8)] group-hover:bg-white"
            : "border-white/[0.09] bg-[#202733] text-white/90 shadow-[0_5px_10px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.06)]"
        } ${accentClass}`}
      >
        <Icon className="h-4.5 w-4.5" />
      </span>
      <span
        className={`text-xs font-medium transition-colors ${
          light ? "text-slate-600 group-hover:text-slate-900" : "text-white/60 group-hover:text-white/90"
        }`}
      >
        {label}
      </span>
    </a>
  );
}

/** Site institucional, mapa e Instagram como atalhos complementares. */
export function DigitalCardContactActions({ address, instagram, onTrack, light = false }: Props) {
  const instagramHref = instagram ? (instagram.startsWith("http") ? instagram : `https://instagram.com/${instagram.replace(/^@/, "")}`) : null;
  const mapHref = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;

  return (
    <div className="space-y-2.5">
      {/* Fileira de acesso rápido */}
      <div className="flex items-start justify-center gap-3.5">
        <IconAction
          icon={Globe2}
          label="Site Reobote"
          href="https://reobote.com.br"
          onClick={() => onTrack("LINK_CLICK")}
          accentClass={
            light
              ? "group-hover:border-sky-500/60 group-hover:bg-sky-50 group-hover:text-sky-600"
              : "group-hover:border-sky-500/40 group-hover:bg-sky-500/20 group-hover:text-sky-400 group-hover:shadow-[0_0_15px_rgba(14,165,233,0.35)]"
          }
          light={light}
        />
        {mapHref && (
          <IconAction
            icon={MapPin}
            label="Mapa"
            href={mapHref}
            onClick={() => onTrack("MAP_CLICK")}
            accentClass={
              light
                ? "group-hover:border-rose-500/60 group-hover:bg-rose-50 group-hover:text-rose-600"
                : "group-hover:border-rose-500/40 group-hover:bg-rose-500/20 group-hover:text-rose-400 group-hover:shadow-[0_0_15px_rgba(244,63,94,0.35)]"
            }
            light={light}
          />
        )}
        {instagramHref && (
          <IconAction
            icon={InstagramIcon}
            label="Instagram"
            href={instagramHref}
            onClick={() => onTrack("INSTAGRAM_CLICK")}
            accentClass={
              light
                ? "group-hover:border-pink-500/60 group-hover:bg-pink-50 group-hover:text-pink-600"
                : "group-hover:border-pink-500/40 group-hover:bg-pink-500/20 group-hover:text-pink-400 group-hover:shadow-[0_0_15px_rgba(236,72,153,0.35)]"
            }
            light={light}
          />
        )}
      </div>

    </div>
  );
}
