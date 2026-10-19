"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/whatsapp/conversas", label: "Conversas" },
  { href: "/whatsapp/central", label: "Atendimentos" },
  { href: "/whatsapp/campanhas", label: "Campanhas" },
  { href: "/whatsapp/scripts", label: "Scripts" },
];

/** Sub-navegação de dentro da aba "WhatsApp" — conversas, campanhas e a biblioteca de scripts moram todos aqui, num lugar só. */
export function WhatsAppSubNav({ showCentral = false }: { showCentral?: boolean }) {
  const pathname = usePathname();

  return (
    // overflow-x-auto: com 4 abas, celular estreito (~320px) cortava a última.
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-neutral-200/60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden dark:border-neutral-800/60">
      {TABS.filter((tab) => showCentral || tab.href !== "/whatsapp/central").map((tab) => {
        // "/whatsapp" (sem sub-rota) redireciona pra Conversas — conta como ativa também.
        const active =
          tab.href === "/whatsapp/conversas"
            ? pathname === "/whatsapp/conversas" || pathname === "/whatsapp"
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`shrink-0 whitespace-nowrap rounded-t-md px-2.5 py-2 text-sm font-medium transition-colors sm:px-3 ${
              active
                ? "border-b-2 border-neutral-900 text-neutral-900 dark:border-white dark:text-white"
                : "border-b-2 border-transparent text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-300"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
