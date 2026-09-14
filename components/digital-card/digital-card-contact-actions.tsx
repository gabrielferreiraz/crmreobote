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

/** Ícone circular + rótulo embaixo (fileira compacta de acesso rápido — layout de referência: Taggo). */
function IconAction({ icon: Icon, label, href, onClick }: { icon: typeof Phone; label: string; href: string; onClick: () => void }) {
  return (
    <a
      href={href}
      onClick={onClick}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
      className="flex flex-col items-center gap-1.5"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/[0.16]">
        <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
      </span>
      <span className="text-[11px] font-medium text-white/60">{label}</span>
    </a>
  );
}

/** Pill grande e sólida — telefone/WhatsApp são as duas ações de contato com mais intenção de conversão, ganham destaque próprio abaixo da fileira de ícones. */
function ProminentPill({ icon: Icon, label, sub, href, onClick }: { icon: typeof Phone; label: string; sub: string; href: string; onClick: () => void }) {
  return (
    <a
      href={href}
      onClick={onClick}
      className="flex items-center gap-3 rounded-2xl bg-[#00aeee] px-4 py-3.5 text-white transition-opacity hover:opacity-90"
    >
      <Icon className="h-4.5 w-4.5 shrink-0" strokeWidth={2.2} />
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-semibold leading-tight">{label}</span>
        <span className="block truncate text-xs text-white/80">{sub}</span>
      </span>
    </a>
  );
}

/** Telefone / WhatsApp / e-mail / mapa — sempre o número/e-mail real do cartão, nunca inventado. Cada clique registra o evento correspondente (pedido explícito), nunca bloqueia a ação em si. */
export function DigitalCardContactActions({ phone, whatsapp, email, address, onTrack }: Props) {
  const whatsappDigits = whatsapp ? normalizePhoneNumber(whatsapp) : null;
  const phoneDigits = phone ? normalizePhoneNumber(phone) : null;
  const hasAny = phoneDigits || whatsappDigits || email || address;
  if (!hasAny) return null;

  const whatsappHref = whatsappDigits ? `https://wa.me/55${whatsappDigits}` : null;
  const phoneHref = phoneDigits ? `tel:+55${phoneDigits}` : null;
  const emailHref = email ? `mailto:${email}` : null;
  const mapHref = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;

  return (
    <div className="space-y-3">
      {/* Fileira de acesso rápido */}
      <div className="flex items-start justify-center gap-5">
        {phoneHref && <IconAction icon={Phone} label="Ligar" href={phoneHref} onClick={() => onTrack("PHONE_CLICK")} />}
        {emailHref && <IconAction icon={Mail} label="E-mail" href={emailHref} onClick={() => onTrack("EMAIL_CLICK")} />}
        {whatsappHref && (
          <IconAction icon={MessageCircle} label="WhatsApp" href={whatsappHref} onClick={() => onTrack("WHATSAPP_CLICK")} />
        )}
        {mapHref && <IconAction icon={MapPin} label="Mapa" href={mapHref} onClick={() => onTrack("MAP_CLICK")} />}
      </div>

      {/* Pills grandes — telefone e WhatsApp ganham destaque próprio, um toque só. */}
      {(phoneHref || whatsappHref) && (
        <div className="space-y-2">
          {phoneHref && phoneDigits && (
            <ProminentPill
              icon={Phone}
              label="Telefone"
              sub={formatBrazilianPhone(phoneDigits) ?? ""}
              href={phoneHref}
              onClick={() => onTrack("PHONE_CLICK")}
            />
          )}
          {whatsappHref && whatsappDigits && (
            <ProminentPill
              icon={MessageCircle}
              label="WhatsApp"
              sub={formatBrazilianPhone(whatsappDigits) ?? ""}
              href={whatsappHref}
              onClick={() => onTrack("WHATSAPP_CLICK")}
            />
          )}
        </div>
      )}
    </div>
  );
}
