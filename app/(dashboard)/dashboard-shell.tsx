"use client";

import { usePathname } from "next/navigation";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLista50 = pathname === "/lista-50";

  return (
    <div
      className={`relative flex h-dvh flex-col overflow-hidden text-neutral-900 dark:text-neutral-100 ${
        isLista50 ? "dark bg-[#0a0a0c] [color-scheme:dark]" : "dashboard-gradient-bg"
      }`}
    >
      {children}
    </div>
  );
}
