"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Kanban, MessageCircle, CalendarDays, Menu, X, Plus, Users, BarChart3, Settings, LogOut, ChevronRight, Moon } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

const PRIMARY_ITEMS = [
  { href: "/", label: "Início", icon: Home, exact: true },
  { href: "/pipeline", label: "Pipeline", icon: Kanban, alsoActiveOn: ["/negocios"] },
  { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { href: "/agenda", label: "Agenda", icon: CalendarDays },
];

const OVERFLOW_ITEMS = [
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

/**
 * Navegação inferior só do mobile (lg:hidden) — drag-and-drop e menus de
 * hover não funcionam bem no toque, então aqui é tudo tap-first: abas fixas
 * pras seções mais usadas + uma folha "Mais" pro resto.
 */
// A ação principal (FAB) muda com a tela — em vez de forçar "novo negócio"
// em todo canto do app, cada seção que tem uma ação de criação óbvia ganha
// seu próprio atalho; onde não faz sentido (Conversas, Início...), some.
const FAB_BY_SECTION: { match: (pathname: string) => boolean; href: string; label: string }[] = [
  { match: (p) => p.startsWith("/pipeline") || p.startsWith("/negocios"), href: "/pipeline?novo=1", label: "Novo negócio" },
  { match: (p) => p.startsWith("/agenda"), href: "/agenda?novo=1", label: "Nova atividade" },
];

export function MobileNav({ signOutAction }: { signOutAction: () => Promise<void> }) {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);

  const isOverflowActive = OVERFLOW_ITEMS.some((i) => pathname.startsWith(i.href)) || pathname.startsWith("/automacoes");
  const fab = FAB_BY_SECTION.find((f) => f.match(pathname));

  return (
    <>
      {fab && (
        <Link
          href={fab.href}
          className="fixed right-4 bottom-20 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-neutral-900 text-white shadow-lg active:scale-95 dark:bg-white dark:text-neutral-900 lg:hidden"
          aria-label={fab.label}
        >
          <Plus className="h-6 w-6" strokeWidth={2.5} />
        </Link>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-neutral-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/95 lg:hidden">
        {PRIMARY_ITEMS.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href) || item.alsoActiveOn?.some((p) => pathname.startsWith(p));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors active:bg-neutral-100 dark:active:bg-neutral-800 ${
                isActive ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-400 dark:text-neutral-500"
              }`}
            >
              <span
                className={`flex h-7 w-11 items-center justify-center rounded-full transition-colors ${
                  isActive ? "bg-neutral-100 dark:bg-neutral-800" : ""
                }`}
              >
                <item.icon className="h-5 w-5" strokeWidth={isActive ? 2.3 : 2} />
              </span>
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors active:bg-neutral-100 dark:active:bg-neutral-800 ${
            isOverflowActive ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-400 dark:text-neutral-500"
          }`}
        >
          <span
            className={`flex h-7 w-11 items-center justify-center rounded-full transition-colors ${
              isOverflowActive ? "bg-neutral-100 dark:bg-neutral-800" : ""
            }`}
          >
            <Menu className="h-5 w-5" strokeWidth={isOverflowActive ? 2.3 : 2} />
          </span>
          Mais
        </button>
      </nav>

      {sheetOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-neutral-900/40 dark:bg-neutral-950/60"
            style={{ animation: "modal-backdrop-in 150ms ease-out" }}
            onClick={() => setSheetOpen(false)}
          />
          <div
            className="animate-sheet-up absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-neutral-200 bg-white pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-2.5 pb-1">
              <span className="h-1 w-9 rounded-full bg-neutral-200 dark:bg-neutral-700" />
            </div>
            <div className="p-4 pt-1">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Mais</p>
                <button type="button" onClick={() => setSheetOpen(false)} className="icon-btn" aria-label="Fechar">
                  <X className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
              <div className="card divide-y divide-neutral-100 overflow-hidden dark:divide-neutral-800">
                {OVERFLOW_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setSheetOpen(false)}
                    className="flex items-center gap-3 p-3 text-sm transition-colors active:bg-neutral-50 dark:active:bg-neutral-800/60"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-neutral-100 dark:bg-neutral-800">
                      <item.icon className="h-4 w-4 text-neutral-500 dark:text-neutral-400" strokeWidth={1.75} />
                    </span>
                    <span className="flex-1 font-medium text-neutral-700 dark:text-neutral-300">{item.label}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-neutral-300 dark:text-neutral-600" strokeWidth={2} />
                  </Link>
                ))}
              </div>

              <div className="card mt-2 flex items-center gap-3 p-3 text-sm">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-neutral-100 dark:bg-neutral-800">
                  <Moon className="h-4 w-4 text-neutral-500 dark:text-neutral-400" strokeWidth={1.75} />
                </span>
                <span className="flex-1 font-medium text-neutral-700 dark:text-neutral-300">Tema</span>
                <ThemeToggle />
              </div>

              <form action={signOutAction}>
                <button
                  type="submit"
                  className="card mt-2 flex w-full items-center gap-3 p-3 text-left text-sm text-red-600 transition-colors active:bg-red-50 dark:text-red-400 dark:active:bg-red-500/10"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-50 dark:bg-red-500/10">
                    <LogOut className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                  <span className="flex-1 font-medium">Sair</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
