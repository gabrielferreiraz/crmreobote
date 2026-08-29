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
 *
 * Fundo em --brand-gradient-dark (degradê cinza-chumbo, mesmo valor nos dois
 * temas — ver app/globals.css) em vez do .card claro/translúcido padrão:
 * pedido explícito de dar mais sofisticação ao Início sem inventar cor nova.
 * O próprio token já existia no CSS com um comentário dizendo que era pra
 * cá ("Cards escuros — ex.: Exige ação do Início") mas nunca tinha sido
 * ligado a nada; só terminei a ideia que já estava reservada. Sendo sempre
 * escuro (não segue o tema claro/escuro do resto da tela), as cores
 * internas (texto, ícone, hover) são fixas na variante "sobre fundo
 * escuro", não condicionais a dark: como em qualquer outro card do app.
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
      tone: "text-amber-400",
      bg: "bg-amber-500/15",
    },
    {
      key: "parados",
      icon: Clock3,
      label: "Parados há mais de 14 dias",
      count: parados14dCount,
      href: "/pipeline?filter=parados-14d",
      tone: "text-red-400",
      bg: "bg-red-500/15",
    },
    {
      key: "conversas",
      icon: MessageCircle,
      label: "Conversas não lidas",
      count: unreadCount,
      href: "/whatsapp/conversas",
      tone: "text-blue-400",
      bg: "bg-blue-500/15",
    },
  ] as const;

  const total = semTarefaCount + parados14dCount + unreadCount;
  if (total === 0) return null;

  return (
    <div
      className="rounded-2xl border border-white/10 p-4 text-white shadow-lg shadow-black/10 transition-all duration-200 ease-smooth"
      style={{ background: "var(--brand-gradient-dark)" }}
    >
      <h2 className="mb-2 text-sm font-medium text-white">Exige ação</h2>
      <div className="space-y-0.5">
        {rows
          .filter((row) => row.count > 0)
          .map((row) => (
            <Link
              key={row.key}
              href={row.href}
              className="group -mx-2 flex items-center gap-2.5 rounded-lg p-1.5 text-sm transition-colors hover:bg-white/5"
            >
              <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${row.bg}`}>
                <row.icon className={`h-3.5 w-3.5 ${row.tone}`} strokeWidth={2} />
              </div>
              <p className="min-w-0 flex-1 truncate text-neutral-200">{row.label}</p>
              <span className={`shrink-0 text-sm font-semibold tabular-nums ${row.tone}`}>{row.count}</span>
              <ArrowRight
                className="h-3.5 w-3.5 shrink-0 text-white/25 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-white/50"
                strokeWidth={2}
              />
            </Link>
          ))}
      </div>
    </div>
  );
}
