"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";

export function SettingsBackLink() {
  const pathname = usePathname();
  if (pathname === "/configuracoes") return null;

  return (
    <Link
      href="/configuracoes"
      className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
    >
      <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
      Configurações
    </Link>
  );
}
