"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LogOut, UserCircle } from "lucide-react";
import { Avatar } from "./avatar";

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
      <button onClick={() => setOpen((v) => !v)} aria-label="Menu do usuário">
        <Avatar name={name} src={photoUrl} size="sm" />
      </button>

      {open && (
        <div className="surface-glass animate-pop-in absolute right-0 z-40 mt-2 w-56 rounded-lg p-1 shadow-xl">
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <Avatar name={name} src={photoUrl} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">{name}</p>
              <p className="truncate text-xs text-neutral-400 dark:text-neutral-500">{email}</p>
            </div>
          </div>
          <div className="my-1 border-t border-neutral-100 dark:border-neutral-800" />
          <Link
            href="/configuracoes/perfil"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >
            <UserCircle className="h-3.5 w-3.5" strokeWidth={2} />
            Editar perfil
          </Link>
          <form action={signOutAction}>
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
