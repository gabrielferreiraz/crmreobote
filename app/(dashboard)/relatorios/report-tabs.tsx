"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

const TABS = [
  { key: "comercial", label: "Comercial" },
  { key: "facebook", label: "Facebook" },
  { key: "processos", label: "Processos" },
] as const;

/**
 * Alternância Comercial/Facebook/Processos — só aparece pro Dono (ver
 * relatorios/page.tsx; consultor/gerente/supervisor nunca tiveram acesso ao
 * módulo de Processos nem ao relatório de Facebook Ads, e Administrativo já
 * cai direto no relatório de processos, sem aba). Muda a URL (?view=), a
 * página (Server Component) decide o que renderizar.
 */
export function ReportTabs({ active }: { active: "comercial" | "facebook" | "processos" }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(view: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (view === "comercial") params.delete("view");
    else params.set("view", view);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    // sticky, não estático: as 3 abas levam pra ramos da página com alturas
    // bem diferentes (Comercial tem cabeçalho+filtros, Processos/Facebook não)
    // — numa troca de aba normal (document flow), a barra em si "pulava" de
    // lugar dependendo de onde a página anterior estava rolada. Presa no topo
    // do scroll, ela nunca se move, não importa o que muda embaixo dela. Fundo
    // sólido + blur porque, sendo sticky, conteúdo rola por baixo dela.
    <div className="sticky top-0 z-20 bg-neutral-50/95 pt-1 pb-2 backdrop-blur-sm dark:bg-neutral-950/95">
      <div className="inline-flex rounded-md border border-neutral-200 bg-neutral-100 p-0.5 dark:border-neutral-800 dark:bg-neutral-800">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => go(tab.key)}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              active === tab.key
                ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-100"
                : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
