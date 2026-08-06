import type { ReactNode } from "react";

// Paleta única de onde toda etiqueta do sistema puxa cor — antes cada tela
// (Clientes, Pipeline, Processos, Relatórios) inventava sua própria
// combinação de border/bg/text pro mesmo tipo de informação (ex.: "tudo
// certo" virava um verde ligeiramente diferente em cada lugar). Duas
// famílias de tom:
// - status (neutral/accent/brand/success/danger/warning): estado de algo —
//   sempre os MESMOS 6 tons em qualquer tela, nunca reaproveitados pra
//   identidade.
// - categoria (blue/pink/slate): identidade de algo que não é nem bom nem
//   ruim (origem do lead, tipo de crédito) — cores emprestadas da marca de
//   quem representam (Facebook=azul, Instagram=rosa) quando faz sentido,
//   senão cai no `neutral` acima.
const TONES = {
  neutral: {
    solid: "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400",
    border: "border-neutral-200 dark:border-neutral-800",
  },
  accent: {
    solid: "bg-brand text-white dark:text-white",
    border: "border-transparent",
  },
  brand: {
    solid: "bg-brand-light dark:bg-brand-light text-brand dark:text-brand",
    border: "border-transparent",
  },
  success: {
    solid: "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-200 dark:border-emerald-800",
  },
  danger: {
    solid: "bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300",
    border: "border-red-200 dark:border-red-800",
  },
  warning: {
    solid: "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300",
    border: "border-amber-200 dark:border-amber-800",
  },
  blue: {
    solid: "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400",
    border: "border-blue-200 dark:border-blue-800",
  },
  pink: {
    solid: "bg-pink-50 dark:bg-pink-500/10 text-pink-700 dark:text-pink-400",
    border: "border-pink-200 dark:border-pink-800",
  },
  slate: {
    solid: "bg-slate-50 dark:bg-slate-500/10 text-slate-600 dark:text-slate-400",
    border: "border-slate-200 dark:border-slate-800",
  },
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  children,
  tone = "neutral",
  dot,
  size = "md",
  className = "",
  title,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  /** "sm" pros lugares mais apertados (card do Kanban) — mesmas cores, só mais compacto. */
  size?: "sm" | "md";
  className?: string;
  title?: string;
}) {
  const t = TONES[tone];
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full border font-medium ${
        size === "sm" ? "gap-1 px-1.5 py-0.5 text-[10px]" : "gap-1.5 px-2.5 py-0.5 text-xs"
      } ${t.solid} ${t.border} ${className}`}
    >
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  );
}
