"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, Kanban, MessageCircle, CalendarDays, ClipboardList, BarChart3, Settings } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Início", icon: Home },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/pipeline", label: "Pipeline", icon: Kanban, alsoActiveOn: ["/negocios"], salesOnly: true },
  { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { href: "/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/processos", label: "Processos", icon: ClipboardList },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { href: "/configuracoes", label: "Configurações", icon: Settings, alsoActiveOn: ["/automacoes"] },
];

/** Administrativo (pós-venda) não vê Pipeline/Negócios — não é o CRM de vendas que ele opera. */
export function TopNavLinks({ isAdministrativo }: { isAdministrativo: boolean }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => !(isAdministrativo && item.salesOnly));

  return (
    <nav className="flex items-center gap-1">
      {items.map((item) => {
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href) || item.alsoActiveOn?.some((p) => pathname.startsWith(p));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-150 ${
              isActive
                ? "bg-brand text-white shadow-sm dark:text-white"
                : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            }`}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={isActive ? 2.3 : 2} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
