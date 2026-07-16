import Link from "next/link";
import { CommandPalette } from "@/components/command-palette";
import { NotificationBell } from "@/components/notification-bell";
import { Avatar } from "@/components/avatar";

/**
 * Cabeçalho compacto só do mobile (lg:hidden) — a navegação principal mora
 * na barra inferior (mobile-nav.tsx); aqui só sobra o essencial: marca,
 * busca e o que precisa estar sempre à mão (avisos, perfil).
 */
export function MobileHeader({ photoUrl, name }: { photoUrl: string | null; name: string }) {
  return (
    <header className="surface-glass relative z-30 flex h-14 shrink-0 items-center gap-2 border-x-0 border-t-0 px-4 lg:hidden">
      <Link href="/" className="flex shrink-0 items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-neutral-900 text-sm font-semibold text-white dark:bg-white dark:text-neutral-900">
          C
        </div>
        <span className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">CRM</span>
      </Link>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <CommandPalette compact />
        <NotificationBell />
        <Link href="/configuracoes/perfil" aria-label="Perfil" className="ml-1">
          <Avatar name={name} src={photoUrl} size="sm" />
        </Link>
      </div>
    </header>
  );
}
