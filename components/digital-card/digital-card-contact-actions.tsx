import { Phone, Mail, MapPin, ChevronRight } from "lucide-react";
import { normalizePhoneNumber, formatBrazilianPhone } from "@/lib/phone-normalize";

type Props = {
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  instagram?: string | null;
  onTrack: (eventType: string) => void;
};

/** Ícone oficial do WhatsApp */
function WhatsappIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.447-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.572-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414zM12.004 2.003c-5.514 0-10 4.486-10 10 0 1.815.485 3.518 1.332 4.988l-1.332 4.909 5.064-1.314c1.42.793 3.056 1.246 4.79 1.246 5.514 0 10-4.486 10-10s-4.486-10-10-10zm0 18.333c-1.579 0-3.08-.426-4.38-1.182l-.314-.183-3.003.78.795-2.923-.201-.32c-.838-1.336-1.282-2.888-1.282-4.505 0-4.595 3.738-8.333 8.333-8.333 4.596 0 8.334 3.738 8.334 8.333 0 4.595-3.738 8.333-8.334 8.333z" />
    </svg>
  );
}

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
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
  onClick: () => void;
  accentClass: string;
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
        className={`flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.07] text-white/90 shadow-md backdrop-blur-md transition-all duration-200 group-hover:scale-105 ${accentClass}`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="text-[10px] font-medium text-white/60 group-hover:text-white/90 transition-colors">{label}</span>
    </a>
  );
}

/** Pill grande e sólida com gradientes vibrantes específicos por tipo de contato. */
function ProminentPill({
  icon: Icon,
  label,
  sub,
  href,
  onClick,
  variant = "cyan",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub: string;
  href: string;
  onClick: () => void;
  variant?: "cyan" | "emerald";
}) {
  const gradientStyles =
    variant === "emerald"
      ? "bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 hover:from-emerald-500 hover:to-teal-500 shadow-[0_4px_16px_rgba(16,185,129,0.3)] border-emerald-400/30"
      : "bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:to-blue-500 shadow-[0_4px_16px_rgba(0,174,238,0.3)] border-cyan-400/30";

  return (
    <a
      href={href}
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-2xl border px-3.5 py-2.5 text-white transition-all hover:scale-[1.01] active:scale-[0.99] overflow-hidden max-w-full ${gradientStyles}`}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/15 backdrop-blur-md">
        <Icon className="h-4 w-4 shrink-0" />
      </div>
      <span className="min-w-0 flex-1 overflow-hidden text-left">
        <span className="block text-[10px] font-bold leading-tight uppercase tracking-wider text-white/80 truncate">{label}</span>
        <span className="block text-xs font-extrabold text-white truncate">{sub}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-white/70" strokeWidth={2.5} />
    </a>
  );
}

/** Telefone / WhatsApp / e-mail / mapa / instagram com estilo visual de alta fidelidade. */
export function DigitalCardContactActions({ phone, whatsapp, email, address, instagram, onTrack }: Props) {
  const whatsappDigits = whatsapp ? normalizePhoneNumber(whatsapp) : null;
  const phoneDigits = phone ? normalizePhoneNumber(phone) : null;
  const instagramHref = instagram ? (instagram.startsWith("http") ? instagram : `https://instagram.com/${instagram.replace(/^@/, "")}`) : null;
  const hasAny = phoneDigits || whatsappDigits || email || address || instagramHref;
  if (!hasAny) return null;

  const whatsappHref = whatsappDigits ? `https://wa.me/55${whatsappDigits}` : null;
  const phoneHref = phoneDigits ? `tel:+55${phoneDigits}` : null;
  const emailHref = email ? `mailto:${email}` : null;
  const mapHref = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;

  return (
    <div className="space-y-2.5">
      {/* Fileira de acesso rápido */}
      <div className="flex items-start justify-center gap-3.5">
        {whatsappHref && (
          <IconAction
            icon={WhatsappIcon}
            label="WhatsApp"
            href={whatsappHref}
            onClick={() => onTrack("WHATSAPP_CLICK")}
            accentClass="group-hover:border-emerald-500/40 group-hover:bg-emerald-500/20 group-hover:text-emerald-400 group-hover:shadow-[0_0_15px_rgba(16,185,129,0.35)]"
          />
        )}
        {emailHref && (
          <IconAction
            icon={Mail}
            label="E-mail"
            href={emailHref}
            onClick={() => onTrack("EMAIL_CLICK")}
            accentClass="group-hover:border-purple-500/40 group-hover:bg-purple-500/20 group-hover:text-purple-400 group-hover:shadow-[0_0_15px_rgba(168,85,247,0.35)]"
          />
        )}
        {mapHref && (
          <IconAction
            icon={MapPin}
            label="Mapa"
            href={mapHref}
            onClick={() => onTrack("MAP_CLICK")}
            accentClass="group-hover:border-rose-500/40 group-hover:bg-rose-500/20 group-hover:text-rose-400 group-hover:shadow-[0_0_15px_rgba(244,63,94,0.35)]"
          />
        )}
        {instagramHref && (
          <IconAction
            icon={InstagramIcon}
            label="Instagram"
            href={instagramHref}
            onClick={() => onTrack("INSTAGRAM_CLICK")}
            accentClass="group-hover:border-pink-500/40 group-hover:bg-pink-500/20 group-hover:text-pink-400 group-hover:shadow-[0_0_15px_rgba(236,72,153,0.35)]"
          />
        )}
      </div>

      {/* Pill grande — WhatsApp com destaque visual interativo */}
      {whatsappHref && whatsappDigits && (
        <div className="space-y-2 pt-0.5">
          <ProminentPill
            icon={WhatsappIcon}
            label="WhatsApp"
            sub={formatBrazilianPhone(whatsappDigits) ?? ""}
            href={whatsappHref}
            onClick={() => onTrack("WHATSAPP_CLICK")}
            variant="emerald"
          />
        </div>
      )}
    </div>
  );
}


