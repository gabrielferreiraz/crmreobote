"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CommandPalette } from "@/components/command-palette";
import { NotificationBell } from "@/components/notification-bell";
import { UserMenu } from "@/components/user-menu";

const SECTION_NAMES: { match: (p: string) => boolean; label: string }[] = [
  { match: (p) => p === "/", label: "Início" },
  { match: (p) => p.startsWith("/pipeline") || p.startsWith("/negocios"), label: "Pipeline" },
  { match: (p) => p.startsWith("/clientes"), label: "Clientes" },
  { match: (p) => p.startsWith("/whatsapp"), label: "WhatsApp" },
  { match: (p) => p.startsWith("/agenda"), label: "Agenda" },
  { match: (p) => p.startsWith("/processos"), label: "Processos" },
  { match: (p) => p.startsWith("/relatorios"), label: "Relatórios" },
  { match: (p) => p.startsWith("/configuracoes") || p.startsWith("/automacoes"), label: "Configurações" },
];

/**
 * Cabeçalho compacto só do mobile (lg:hidden) — a navegação principal mora
 * na barra inferior (mobile-nav.tsx); aqui só sobra o essencial: marca,
 * busca e o que precisa estar sempre à mão (avisos, perfil).
 */
export function MobileHeader({
  photoUrl,
  name,
  email,
  signOutAction,
}: {
  photoUrl: string | null;
  name: string;
  email: string;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const section = SECTION_NAMES.find((s) => s.match(pathname));

  return (
    <header className="surface-glass relative z-30 flex h-14 shrink-0 items-center gap-2 border-x-0 border-t-0 px-4 lg:hidden">
      <Link href="/" className="flex shrink-0 items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white dark:text-white">
          C
        </div>
        <span className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">CRM</span>
      </Link>

      {/* Current section name */}
      {section && section.label !== "Início" && (
        <span className="text-sm font-medium text-neutral-400 dark:text-neutral-500">
          / {section.label}
        </span>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <CommandPalette compact />
        <NotificationBell />
        <div className="ml-1">
          <UserMenu name={name} email={email} photoUrl={photoUrl} signOutAction={signOutAction} />
        </div>
      </div>
    </header>
  );
}
