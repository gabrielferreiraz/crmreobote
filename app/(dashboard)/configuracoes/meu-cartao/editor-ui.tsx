"use client";

import { Globe, Link2, type LucideIcon } from "lucide-react";

/**
 * Peças visuais da tela de edição do cartão (card-editor.tsx) — só da
 * EDIÇÃO; o cartão público (components/digital-card/) não usa nada daqui.
 */

/**
 * Seção do editor. Não usa `.card` de propósito: aquela classe tem
 * `backdrop-filter` e sobe 1px no hover — num formulário longo a tela
 * "pulava" a cada passada de mouse, e `backdrop-filter` vira o bloco de
 * contenção de qualquer `position: fixed` lá dentro (um modal aberto de
 * dentro da seção ficava preso nela, cortado).
 */
export function EditorSection({
  icon: Icon,
  title,
  aside,
  children,
}: {
  icon: LucideIcon;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/70 bg-white/75 p-4 shadow-[0_1px_3px_rgba(20,24,50,0.06),0_10px_20px_-8px_rgba(20,24,50,0.08)] sm:p-5 dark:border-white/10 dark:bg-neutral-900/60 dark:shadow-none">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-light text-brand dark:bg-[var(--brand-subtle)]">
          <Icon className="h-4 w-4" strokeWidth={2.2} />
        </span>
        <h2 className="min-w-0 flex-1 text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Interruptor liga/desliga no tamanho de dedo (o mesmo gesto do celular). */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Lido pelo leitor de tela — o rótulo visível fica ao lado, por conta de quem usa. */
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50 ${
        checked ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-600"
      }`}
    >
      <span
        className={`inline-block h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function svgIcon(path: string) {
  return function BrandIcon({ className }: { className?: string }) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={path} />
      </svg>
    );
  };
}

const InstagramIcon = svgIcon(
  "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z",
);
const LinkedinIcon = svgIcon(
  "M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z",
);
const FacebookIcon = svgIcon(
  "M9 8H6v4h3v12h5V12h3.642L18 8h-4V6.333C14 5.374 14.5 5 15.5 5H18V0h-3.808C10.592 0 9 1.583 9 4.615V8z",
);
const YoutubeIcon = svgIcon(
  "M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z",
);

type LinkTypeMeta = {
  label: string;
  icon: (props: { className?: string }) => React.ReactNode;
  /** Como a pessoa costuma ter isso anotado — "@seuperfil", não "https://...". */
  placeholder: string;
  /** Site/Outro: o botão precisa de um nome (o tipo sozinho não diz o que é). */
  needsName: boolean;
};

export const LINK_TYPES: Record<string, LinkTypeMeta> = {
  INSTAGRAM: { label: "Instagram", icon: InstagramIcon, placeholder: "@seuperfil", needsName: false },
  WEBSITE: { label: "Site", icon: Globe, placeholder: "seusite.com.br", needsName: true },
  LINKEDIN: { label: "LinkedIn", icon: LinkedinIcon, placeholder: "linkedin.com/in/seunome", needsName: false },
  FACEBOOK: { label: "Facebook", icon: FacebookIcon, placeholder: "facebook.com/suapagina", needsName: false },
  YOUTUBE: { label: "YouTube", icon: YoutubeIcon, placeholder: "@seucanal", needsName: false },
  OTHER: { label: "Outro", icon: Link2, placeholder: "endereço do link", needsName: true },
};

export const LINK_TYPE_ORDER = ["INSTAGRAM", "WEBSITE", "LINKEDIN", "FACEBOOK", "YOUTUBE", "OTHER"] as const;

/**
 * O que a pessoa digitou → link de verdade. Quem não é de tecnologia anota
 * "@joao.consorcio" ou "reobote.com.br", nunca "https://..."; antes isso
 * voltava do servidor como "URL inválida". Link que já começa com http(s)
 * passa intacto.
 */
export function normalizeLinkUrl(type: string, raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  const handle = value.replace(/^@/, "");
  // Nome de usuário (pode ter ponto: "joao.consorcio") = sem barra e sem o
  // domínio da própria rede. "instagram.com/joao" segue como endereço.
  const isHandle = (domain: string) => value.startsWith("@") || (!value.includes("/") && !value.toLowerCase().includes(domain));
  if (type === "INSTAGRAM" && isHandle("instagram.")) return `https://instagram.com/${handle}`;
  if (type === "YOUTUBE" && isHandle("youtu")) return `https://youtube.com/@${handle}`;
  if (type === "LINKEDIN" && isHandle("linkedin.")) return `https://linkedin.com/in/${handle}`;
  if (type === "FACEBOOK" && isHandle("facebook.")) return `https://facebook.com/${handle}`;
  return `https://${value.replace(/^\/+/, "")}`;
}

export function isValidLinkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname.includes(".");
  } catch {
    return false;
  }
}
