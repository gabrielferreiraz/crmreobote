"use client";

import { Globe, Link2, ExternalLink } from "lucide-react";

type Link = { id: string; type: string; label: string; url: string };

// lucide-react removeu os ícones de marca (Instagram/LinkedIn/Facebook/
// YouTube) desta versão (1.x) — em vez de um substituto genérico que
// pareceria "quase certo mas errado" (o tipo de detalhe que faz um cartão
// parecer template barato, exatamente o que o pedido pede pra evitar), uso
// um único glifo neutro (link) pra todo tipo social; o nome (label) já
// identifica a rede — Website continua com o globo, única diferenciação que
// faz sentido sem um ícone de marca de verdade.
const ICON_BY_TYPE: Record<string, typeof Globe> = {
  WEBSITE: Globe,
};

const TRACKED_EVENT_BY_TYPE: Record<string, string> = {
  INSTAGRAM: "INSTAGRAM_CLICK",
  LINKEDIN: "LINKEDIN_CLICK",
};

/** Links adicionais configuráveis (Instagram/LinkedIn/site/...) — nunca uma quantidade fixa, itera sobre o que o cartão tiver cadastrado. */
export function DigitalCardLinks({ links, onTrack }: { links: Link[]; onTrack: (eventType: string) => void }) {
  if (links.length === 0) return null;

  return (
    <div className="space-y-2">
      {links.map((link) => {
        const Icon = ICON_BY_TYPE[link.type] ?? Link2;
        return (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onTrack(TRACKED_EVENT_BY_TYPE[link.type] ?? "LINK_CLICK")}
            className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 transition-colors hover:bg-white/[0.08]"
          >
            <Icon className="h-4 w-4 shrink-0 text-white/60" strokeWidth={2} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">{link.label}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-white/30" strokeWidth={2} />
          </a>
        );
      })}
    </div>
  );
}
