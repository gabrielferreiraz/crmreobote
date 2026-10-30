/**
 * Esqueleto da planilha enquanto o servidor monta a página (abrir uma planilha não
 * deixa o clique "morto"): mesma silhueta da tela real — barra, faixa de opções,
 * barra de fórmulas e a grade —, só CSS, sem nenhuma consulta. Os dados entram por
 * cima sem a página pular de lugar.
 */
export default function PlanilhaLoading() {
  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col overflow-hidden bg-white dark:bg-neutral-950" aria-busy="true" aria-label="Abrindo planilha">
      <div className="h-9 shrink-0 bg-[#217346] dark:bg-[#185c37]" />
      <div className="flex h-[92px] shrink-0 items-center gap-3 border-b border-neutral-200 bg-neutral-50 px-4 dark:border-neutral-800 dark:bg-neutral-900">
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="h-14 w-16 animate-pulse rounded-md bg-neutral-200/70 dark:bg-neutral-800" style={{ animationDelay: `${i * 60}ms` }} />
        ))}
      </div>
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-neutral-200 px-2 dark:border-neutral-800">
        <div className="h-4 w-16 rounded bg-neutral-200/70 dark:bg-neutral-800" />
        <div className="h-4 flex-1 rounded bg-neutral-100 dark:bg-neutral-900" />
      </div>
      <div
        className="flex-1 opacity-70"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--xl-grid, #e1e1e1) 1px, transparent 1px), linear-gradient(to bottom, var(--xl-grid, #e1e1e1) 1px, transparent 1px)",
          backgroundSize: "120px 21px",
          backgroundPosition: "40px 22px",
        }}
      />
    </div>
  );
}
