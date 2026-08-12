"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Settings, UserCircle, Sun, Moon } from "lucide-react";
import { Avatar } from "./avatar";
import { usePushSubscription } from "@/lib/use-push-subscription";
import { useTheme } from "./theme-provider";

export function UserMenu({
  name,
  email,
  photoUrl,
  signOutAction,
}: {
  name: string;
  email: string;
  photoUrl?: string | null;
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { unsubscribe } = usePushSubscription();
  const { theme, toggle: toggleTheme } = useTheme();
  const pathname = usePathname();
  // Configurações saiu da fileira de cima (ver top-nav-links.tsx) e mora só
  // aqui agora — sem indicação nenhuma, dava pra navegar por Configurações
  // inteiro sem nenhum sinal visual de "você está aqui" em lugar nenhum do
  // header. O anel no avatar substitui o destaque que o item da fileira de
  // cima dava antes.
  const isConfigActive = pathname.startsWith("/configuracoes") || pathname.startsWith("/automacoes");

  // Desativa a inscrição de push deste NAVEGADOR antes de sair — sem isso,
  // num computador compartilhado, a inscrição continua ativa (a nível de SO)
  // mesmo deslogado, e a próxima pessoa a usar o aparelho (ou só alguém por
  // perto, já que notificação push aparece mesmo com o site fechado) via
  // notificação com nome de lead/negócio de quem saiu. Nunca bloqueia o
  // logout em si (unsubscribe() já engole os próprios erros).
  async function handleSignOut(e: React.FormEvent) {
    e.preventDefault();
    await unsubscribe();
    await signOutAction();
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Menu do usuário"
        className={`rounded-full transition-all duration-200 ease-smooth ${
          isConfigActive ? "ring-2 ring-brand ring-offset-2 ring-offset-white dark:ring-offset-neutral-900" : ""
        }`}
      >
        <Avatar name={name} src={photoUrl} size="sm" />
      </button>

      {open && (
        <div className="surface-glass-panel animate-pop-in absolute right-0 z-40 mt-2 w-56 rounded-lg p-1">
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <Avatar name={name} src={photoUrl} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">{name}</p>
              <p className="truncate text-xs text-neutral-400 dark:text-neutral-500">{email}</p>
            </div>
          </div>
          <div className="my-1 border-t border-neutral-100 dark:border-neutral-800" />
          <Link
            href="/configuracoes"
            onClick={() => setOpen(false)}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm ${
              isConfigActive
                ? "bg-brand-light text-brand dark:bg-brand-light dark:text-brand"
                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            }`}
          >
            <Settings className="h-3.5 w-3.5" strokeWidth={2} />
            Configurações
          </Link>
          <Link
            href="/configuracoes/perfil"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >
            <UserCircle className="h-3.5 w-3.5" strokeWidth={2} />
            Editar perfil
          </Link>
          <button
            type="button"
            onClick={toggleTheme}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >
            {theme === "dark" ? (
              <Sun className="h-3.5 w-3.5" strokeWidth={2} />
            ) : (
              <Moon className="h-3.5 w-3.5" strokeWidth={2} />
            )}
            {theme === "dark" ? "Modo claro" : "Modo escuro"}
          </button>
          <div className="my-1 border-t border-neutral-100 dark:border-neutral-800" />
          <form action={signOutAction} onSubmit={handleSignOut}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            >
              <LogOut className="h-3.5 w-3.5" strokeWidth={2} />
              Sair
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
