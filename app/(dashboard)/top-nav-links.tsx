"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, Kanban, MessageCircle, CalendarDays, ClipboardList, BarChart3 } from "lucide-react";
import { LoadingDots } from "@/components/loading-dots";

// Configurações saiu daqui — mora no menu do usuário agora (ver
// components/user-menu.tsx), pra deixar essa fileira só com o que é
// trabalho do dia a dia (menos itens grudados aqui em cima).
const NAV_ITEMS = [
  { href: "/", label: "Início", icon: Home },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/pipeline", label: "Pipeline", icon: Kanban, alsoActiveOn: ["/negocios"], salesOnly: true },
  { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { href: "/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/processos", label: "Processos", icon: ClipboardList },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
];

/**
 * Enquanto o Next navega pra rota (sem loading.tsx em nenhuma página do
 * dashboard, a troca pode levar um instante com dado carregando), some com
 * "..." flutuando ao lado do nome — sem isso, clicar num link parecia não
 * ter feito nada até a página seguinte terminar de renderizar. Ícone e
 * rótulo nunca mudam, só isso é adicionado. Só funciona dentro de um <Link>
 * (useLinkStatus).
 */
function NavLinkContent({ icon: Icon, label, isActive }: { icon: typeof Home; label: string; isActive: boolean }) {
  const { pending } = useLinkStatus();
  return (
    <>
      <Icon className="h-3 w-3 shrink-0" strokeWidth={isActive ? 2.3 : 2} />
      {label}
      {pending && <LoadingDots />}
    </>
  );
}

/** Administrativo (pós-venda) não vê Pipeline/Negócios — não é o CRM de vendas que ele opera. */
export function TopNavLinks({ isAdministrativo }: { isAdministrativo: boolean }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => !(isAdministrativo && item.salesOnly));

  return (
    // Nunca rola de lado (overflow-x-hidden, de propósito — nada de
    // scrollbar aqui, feio numa fileira curta e sempre visível). O nome de
    // cada página fica sempre visível (não é isto que deve encolher quando
    // aperta — ver busca/"Novo negócio" em layout.tsx, que viram só ícone
    // pra abrir espaço; o nav de páginas nunca).
    <nav className="flex min-w-0 items-center gap-0.5 overflow-x-hidden">
      {items.map((item) => {
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href) || (item.alsoActiveOn?.some((p) => pathname.startsWith(p)) ?? false);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-all duration-150 ${
              isActive
                ? "bg-brand text-white shadow-sm dark:text-white"
                : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            }`}
          >
            <NavLinkContent icon={Icon} label={item.label} isActive={isActive} />
          </Link>
        );
      })}
    </nav>
  );
}
