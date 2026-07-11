"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Início" },
  { href: "/clientes", label: "Clientes" },
  { href: "/pipeline", label: "Pipeline", alsoActiveOn: ["/negocios"] },
  { href: "/conversas", label: "Conversas" },
  { href: "/agenda", label: "Agenda" },
  { href: "/relatorios", label: "Relatórios" },
  { href: "/automacoes", label: "Automações" },
  { href: "/configuracoes", label: "Configurações" },
];

export function TopNavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-5">
      {NAV_ITEMS.map((item) => {
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href) || item.alsoActiveOn?.some((p) => pathname.startsWith(p));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`border-b-2 py-1 text-sm font-medium transition-colors ${
              isActive
                ? "border-neutral-900 text-neutral-900 dark:border-white dark:text-white"
                : "border-transparent text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
