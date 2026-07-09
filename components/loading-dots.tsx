export function LoadingDots({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-end gap-0.5 ${className}`} aria-hidden="true">
      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
      <span className="h-1 w-1 animate-bounce rounded-full bg-current" />
    </span>
  );
}
