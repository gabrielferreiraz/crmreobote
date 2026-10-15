import type { SentencePart } from "@/lib/commissions/describe";

/** Renderiza uma frase de configuração (ver lib/commissions/describe.ts) com os destaques em negrito. */
export function Sentence({ parts, className = "" }: { parts: SentencePart[]; className?: string }) {
  return (
    <p className={`text-sm leading-relaxed text-neutral-700 dark:text-neutral-300 ${className}`}>
      {parts.map((part, i) =>
        typeof part === "string" ? (
          <span key={i}>{part}</span>
        ) : (
          <strong key={i} className="font-semibold text-neutral-900 dark:text-neutral-100">
            {part.strong}
          </strong>
        ),
      )}
    </p>
  );
}
