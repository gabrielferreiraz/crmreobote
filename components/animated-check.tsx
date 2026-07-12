/** Check "desenhado" ao vivo — só anima no instante da conclusão (justDrawn=true); depois de montado uma vez, fica estático como um ícone comum. */
export function AnimatedCheck({ className = "", justDrawn = false }: { className?: string; justDrawn?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" />
      <path
        d="M8 12.5l2.5 2.5L16 9.5"
        stroke="currentColor"
        style={
          justDrawn
            ? { strokeDasharray: 16, strokeDashoffset: 16, animation: "check-draw 0.35s ease-out 0.05s forwards" }
            : undefined
        }
      />
    </svg>
  );
}
