import { ArrowUpRight, Check, GraduationCap, RefreshCw } from "lucide-react";
import type { AcademyOnboardingState } from "@/lib/academy-onboarding";

export function AcademyOnboardingCard({
  status,
  academyHref,
  name,
  preview = false,
}: {
  status: AcademyOnboardingState;
  academyHref: string | null;
  name: string;
  preview?: boolean;
}) {
  const started = status === "STARTED";
  const firstName = name.trim().split(/\s+/)[0] || "Consultor";

  return (
    <section className="academy-card-enter mx-auto w-full max-w-[560px] rounded-lg border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 sm:p-9">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-light text-brand">
        <GraduationCap className="h-5 w-5" strokeWidth={2} />
      </div>

      <p className="mt-6 text-xs font-semibold uppercase text-brand">Primeiro passo</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-normal sm:text-3xl">
        {started ? "Continue seu treinamento" : `Bem-vindo, ${firstName}`}
      </h1>
      <p className="mt-3 text-base font-medium text-neutral-800 dark:text-neutral-200">
        Curso Reobote Consórcios Academy
      </p>
      <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
        {started
          ? "Seu progresso está salvo. O CRM será liberado quando você chegar ao módulo da plataforma."
          : "Comece pelo treinamento. Ao chegar ao módulo de CRM, seu acesso será liberado automaticamente."}
      </p>

      <ol className="my-7 grid grid-cols-3 border-y border-neutral-200 py-4 dark:border-neutral-800" aria-label="Etapas de liberação">
        <li className="border-r border-neutral-200 pr-3 dark:border-neutral-800">
          <span className="text-xs text-neutral-400">1</span>
          <p className="mt-1 text-xs font-semibold sm:text-sm">Treinamento</p>
        </li>
        <li className="border-r border-neutral-200 px-3 dark:border-neutral-800">
          <span className="text-xs text-neutral-400">2</span>
          <p className="mt-1 text-xs font-semibold sm:text-sm">Módulo CRM</p>
        </li>
        <li className="pl-3">
          <Check className="h-4 w-4 text-neutral-400" strokeWidth={2} aria-hidden />
          <p className="mt-1 text-xs font-semibold sm:text-sm">Acesso</p>
        </li>
      </ol>

      {preview ? (
        <span className="btn-primary flex w-full justify-center py-3" aria-hidden>
          {started ? "Continuar aulas" : "Começar treinamento"}
          <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
        </span>
      ) : academyHref ? (
        <a href={academyHref} className="btn-primary flex w-full justify-center py-3">
          {started ? "Continuar aulas" : "Começar treinamento"}
          <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
        </a>
      ) : (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          A Academy está indisponível no momento. Tente novamente em alguns minutos.
        </div>
      )}

      {started && (
        preview ? (
          <span className="btn-secondary mt-3 flex w-full justify-center py-2.5" aria-hidden>
            <RefreshCw className="h-4 w-4" strokeWidth={2} />
            Atualizar acesso
          </span>
        ) : (
          <form action="/" method="get" className="mt-3">
            <button type="submit" className="btn-secondary flex w-full justify-center py-2.5">
              <RefreshCw className="h-4 w-4" strokeWidth={2} />
              Atualizar acesso
            </button>
          </form>
        )
      )}
    </section>
  );
}
