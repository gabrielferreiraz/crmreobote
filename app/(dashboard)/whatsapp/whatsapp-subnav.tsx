"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/whatsapp/conversas", label: "Conversas" },
  { href: "/whatsapp/campanhas", label: "Campanhas" },
  { href: "/whatsapp/scripts", label: "Scripts" },
];

/** Sub-navegação de dentro da aba "WhatsApp" — conversas, campanhas e a biblioteca de scripts moram todos aqui, num lugar só. */
export function WhatsAppSubNav() {
  const pathname = usePathname();

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-neutral-200/60 dark:border-neutral-800/60">
      {TABS.map((tab) => {
        // "/whatsapp" (sem sub-rota) redireciona pra Conversas — conta como ativa também.
        const active =
          tab.href === "/whatsapp/conversas"
            ? pathname === "/whatsapp/conversas" || pathname === "/whatsapp"
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-t-md px-3 py-2 text-sm font-medium transition-colors ${
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
