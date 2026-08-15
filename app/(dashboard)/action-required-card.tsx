import Link from "next/link";
import { ArrowRight, ClipboardX, Clock3, MessageCircle } from "lucide-react";

/**
 * Card "Exige ação" do Início (ver new-design-for-claude/README.md) — três
 * linhas clicáveis que já levam pro Pipeline/Conversas pré-filtrado, em vez
 * de só mostrar um número solto sem próximo passo nenhum. Componente
 * puramente apresentacional (mesmo espírito de stale-deals-list.tsx, mas sem
 * paginação/estado próprio) — page.tsx já busca as 3 contagens junto do
 * resto no Promise.all principal, esse arquivo só existe pra não misturar
 * esse bloco de JSX no meio de page.tsx.
 */
export function ActionRequiredCard({
  semTarefaCount,
  parados14dCount,
  unreadCount,
}: {
  semTarefaCount: number;
  parados14dCount: number;
  unreadCount: number;
}) {
  const rows = [
    {
      key: "sem-tarefa",
      icon: ClipboardX,
      label: "Negócios sem tarefa",
      count: semTarefaCount,
      href: "/pipeline?filter=sem-tarefa",
      tone: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-500/10",
    },
    {
      key: "parados",
      icon: Clock3,
      label: "Parados há mais de 14 dias",
      count: parados14dCount,
      href: "/pipeline?filter=parados-14d",
      tone: "text-red-600 dark:text-red-400",
      bg: "bg-red-50 dark:bg-red-500/10",
    },
    {
      key: "conversas",
      icon: MessageCircle,
      label: "Conversas não lidas",
      count: unreadCount,
      href: "/whatsapp/conversas",
      tone: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-500/10",
    },
  ] as const;

  const total = semTarefaCount + parados14dCount + unreadCount;
  if (total === 0) return null;

  return (
    <div className="card p-4">
      <h2 className="mb-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">Exige ação</h2>
      <div className="space-y-0.5">
        {rows
          .filter((row) => row.count > 0)
          .map((row) => (
            <Link
              key={row.key}
              href={row.href}
              className="group -mx-2 flex items-center gap-2.5 rounded-lg p-1.5 text-sm transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
            >
              <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${row.bg}`}>
                <row.icon className={`h-3.5 w-3.5 ${row.tone}`} strokeWidth={2} />
              </div>
              <p className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-300">{row.label}</p>
              <span className={`shrink-0 text-sm font-semibold tabular-nums ${row.tone}`}>{row.count}</span>
              <ArrowRight
                className="h-3.5 w-3.5 shrink-0 text-neutral-300 transition-transform duration-150 group-hover:translate-x-0.5 dark:text-neutral-600"
                strokeWidth={2}
              />
            </Link>
          ))}
      </div>
    </div>
  );
}
