"use client";

import { Phone, MessageCircle, Mail, MapPin } from "lucide-react";
import { normalizePhoneNumber, formatBrazilianPhone } from "@/lib/phone-normalize";

type Props = {
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  onTrack: (eventType: string) => void;
};

function ActionButton({
  icon: Icon,
  label,
  sub,
  href,
  onClick,
}: {
  icon: typeof Phone;
  label: string;
  sub?: string;
  href: string;
  onClick: () => void;
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
      className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 transition-colors hover:bg-white/[0.08]"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#00aeee]/15 text-[#00aeee]">
        <Icon className="h-4 w-4" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-white">{label}</span>
        {sub && <span className="block truncate text-xs text-white/50">{sub}</span>}
      </span>
    </a>
  );
}

/** Telefone / WhatsApp / e-mail / mapa — sempre o número/e-mail real do cartão, nunca inventado. Cada clique registra o evento correspondente (pedido explícito), nunca bloqueia a ação em si. */
export function DigitalCardContactActions({ phone, whatsapp, email, address, onTrack }: Props) {
  const hasAny = phone || whatsapp || email || address;
  if (!hasAny) return null;

  const whatsappDigits = whatsapp ? normalizePhoneNumber(whatsapp) : null;
  const phoneDigits = phone ? normalizePhoneNumber(phone) : null;

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {whatsappDigits && (
        <ActionButton
          icon={MessageCircle}
          label="WhatsApp"
          sub={formatBrazilianPhone(whatsappDigits) ?? undefined}
          href={`https://wa.me/55${whatsappDigits}`}
          onClick={() => onTrack("WHATSAPP_CLICK")}
        />
      )}
      {phoneDigits && (
        <ActionButton
          icon={Phone}
          label="Ligar"
          sub={formatBrazilianPhone(phoneDigits) ?? undefined}
          href={`tel:+55${phoneDigits}`}
          onClick={() => onTrack("PHONE_CLICK")}
        />
      )}
      {email && (
        <ActionButton icon={Mail} label="E-mail" sub={email} href={`mailto:${email}`} onClick={() => onTrack("EMAIL_CLICK")} />
      )}
      {address && (
        <ActionButton
          icon={MapPin}
          label="Localização"
          sub={address}
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
          onClick={() => onTrack("MAP_CLICK")}
        />
      )}
    </div>
  );
}
