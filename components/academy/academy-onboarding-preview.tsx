"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, X } from "lucide-react";
import { AcademyOnboardingCard } from "@/components/academy/academy-onboarding-card";
import type { AcademyOnboardingState } from "@/lib/academy-onboarding";

export function AcademyOnboardingPreview({ name, onClose }: { name: string; onClose: () => void }) {
  const [status, setStatus] = useState<AcademyOnboardingState>("REQUIRED");

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[200] flex min-h-dvh flex-col overflow-y-auto bg-neutral-100 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" role="dialog" aria-modal="true" aria-label="Prévia do primeiro acesso">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950 sm:px-8">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-sm font-bold text-white">C</span>
          <span className="text-sm font-semibold">CRM Reobote</span>
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">Prévia</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-neutral-200 bg-neutral-100 p-0.5 dark:border-neutral-800 dark:bg-neutral-900">
            <button type="button" onClick={() => setStatus("REQUIRED")} className={`rounded px-2.5 py-1.5 text-xs font-medium ${status === "REQUIRED" ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100" : "text-neutral-500"}`}>
              Primeiro acesso
            </button>
            <button type="button" onClick={() => setStatus("STARTED")} className={`rounded px-2.5 py-1.5 text-xs font-medium ${status === "STARTED" ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100" : "text-neutral-500"}`}>
              Retorno
            </button>
          </div>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Fechar prévia" title="Fechar">
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center p-4 sm:p-8">
        <div className="w-full">
          <p className="mx-auto mb-3 flex max-w-[560px] items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            <Eye className="h-3.5 w-3.5" strokeWidth={2} />
            Visualização apenas. Nenhum acesso será alterado.
          </p>
          <AcademyOnboardingCard status={status} academyHref={null} name={name} preview />
        </div>
      </main>
    </div>,
    document.body,
  );
}
