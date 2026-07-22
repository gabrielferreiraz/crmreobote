"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Início" },
  { href: "/clientes", label: "Clientes" },
  { href: "/pipeline", label: "Pipeline", alsoActiveOn: ["/negocios"], salesOnly: true },
  { href: "/whatsapp", label: "WhatsApp" },
  { href: "/agenda", label: "Agenda" },
  { href: "/processos", label: "Processos" },
  { href: "/relatorios", label: "Relatórios" },
  { href: "/configuracoes", label: "Configurações", alsoActiveOn: ["/automacoes"] },
];

/** Administrativo (pós-venda) não vê Pipeline/Negócios — não é o CRM de vendas que ele opera. */
export function TopNavLinks({ isAdministrativo }: { isAdministrativo: boolean }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => !(isAdministrativo && item.salesOnly));

  return (
    <nav className="flex items-center gap-5">
      {items.map((item) => {
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
