"use client";

import { ArrowLeft, ChevronRight, ExternalLink, Lightbulb, AlertTriangle, MousePointerClick } from "lucide-react";
import type { HelpTopic } from "@/lib/help/types";
import { HELP_ICONS, HELP_FALLBACK_ICON } from "./help-icons";

/**
 * Um verbete aberto. Três blocos, sempre na mesma ordem, porque é a ordem em
 * que a pessoa precisa deles: o que é → como fazer → o botão que leva lá.
 *
 * O botão de destino é o ponto: ajuda que termina em "vá em Configurações →
 * Pipeline" obriga a pessoa a navegar de novo e é onde ela desiste. Aqui o
 * último passo é um clique.
 */
export function HelpTopicView({
  topic,
  onBack,
  onNavigate,
  onStartTour,
  academyHref,
}: {
  topic: HelpTopic;
  onBack: () => void;
  onNavigate: (href: string, newTab?: boolean) => void;
  onStartTour: (tourId: string) => void;
  academyHref?: string | null;
}) {
  const Icon = HELP_ICONS[topic.icon] ?? HELP_FALLBACK_ICON;
  const links =
    topic.id === "treinamento-academy"
      ? academyHref
        ? [{ label: "Acessar Treinamento", href: academyHref, newTab: true }]
        : []
      : topic.links ?? [];

  return (
    <div className="space-y-4 p-4">
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
        Voltar
      </button>

      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand shadow-sm shadow-brand/30">
          <Icon className="h-5 w-5 text-white" strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">{topic.title}</h3>
          <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">{topic.summary}</p>
        </div>
      </div>

      {topic.tourId && (
        <button
          type="button"
          onClick={() => onStartTour(topic.tourId!)}
          className="group flex w-full items-center gap-3 rounded-lg bg-brand-light p-3 text-left transition-colors hover:bg-brand-light-hover"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand text-white">
            <MousePointerClick className="h-4 w-4" strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-brand">Me mostrar na tela</span>
            <span className="block text-xs text-neutral-500 dark:text-neutral-400">
              Aponta cada parte ao vivo, sem sair do que você está fazendo.
            </span>
          </span>
          <ChevronRight
            className="h-4 w-4 shrink-0 text-brand transition-transform group-hover:translate-x-0.5"
            strokeWidth={2.5}
          />
        </button>
      )}

      {topic.steps && topic.steps.length > 0 && (
        <ol className="space-y-2.5">
          {topic.steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[11px] font-bold text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 text-sm text-neutral-600 dark:text-neutral-300">{step}</span>
            </li>
          ))}
        </ol>
      )}

      {topic.reference && topic.reference.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
          {topic.reference.map((row) => (
            <div
              key={row.code}
              className="flex items-baseline gap-3 border-b border-neutral-100 px-3 py-2 last:border-b-0 dark:border-neutral-800"
            >
              <code className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-brand dark:bg-neutral-800">
                {row.code}
              </code>
              <span className="min-w-0 flex-1 text-xs text-neutral-500 dark:text-neutral-400">{row.meaning}</span>
            </div>
          ))}
        </div>
      )}

      {topic.note && (
        <div
          className={`flex gap-2.5 rounded-lg p-3 ${
            topic.note.kind === "warn"
              ? "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-300"
              : "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-300"
          }`}
        >
          {topic.note.kind === "warn" ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
          ) : (
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
          )}
          <p className="text-xs leading-relaxed">{topic.note.text}</p>
        </div>
      )}

      {links.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          {links.map((link, i) => (
            <button
              key={link.href}
              type="button"
              onClick={() => onNavigate(link.href, link.newTab)}
              className={i === 0 ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
            >
              {link.label}
              {link.newTab ? (
                <ExternalLink className="-mr-0.5 h-3.5 w-3.5" strokeWidth={2} />
              ) : (
                <ChevronRight className="-mr-1 h-3.5 w-3.5" strokeWidth={2.5} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
