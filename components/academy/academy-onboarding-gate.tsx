import { LogOut } from "lucide-react";
import type { AcademyOnboardingState } from "@/lib/academy-onboarding";
import { AcademyOnboardingCard } from "@/components/academy/academy-onboarding-card";

export function AcademyOnboardingGate({
  status,
  academyHref,
  name,
  signOutAction,
}: {
  status: AcademyOnboardingState;
  academyHref: string | null;
  name: string;
  signOutAction: () => Promise<void>;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-neutral-100 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-5 dark:border-neutral-800 dark:bg-neutral-950 sm:px-8">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-sm font-bold text-white">C</span>
          <span className="text-sm font-semibold">CRM Reobote</span>
        </div>
        <form action={signOutAction}>
          <button type="submit" className="btn-ghost btn-sm text-neutral-500" aria-label="Sair">
            <LogOut className="h-4 w-4" strokeWidth={2} />
            Sair
          </button>
        </form>
      </header>

      <main className="flex flex-1 items-center justify-center p-4 sm:p-8">
        <AcademyOnboardingCard status={status} academyHref={academyHref} name={name} />
      </main>
    </div>
  );
}
