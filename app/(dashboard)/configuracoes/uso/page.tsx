import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BarChart3, ChevronRight, Info } from "lucide-react";
import { auth } from "@/lib/auth";
import { runWithTenant } from "@/lib/tenant-context";
import { getFeatureUsageReport } from "@/lib/feature-usage/queries";

export const dynamic = "force-dynamic";

const PERIOD_OPTIONS = [7, 30, 90] as const;
const DEFAULT_PERIOD_DAYS = 30;

const fmt = (n: number) => n.toLocaleString("pt-BR");

/**
 * "Uso do CRM" — quais recursos a equipe mais usa, QUEM usa e quantas vezes, e
 * quais ninguém abre. Alimentado por FeatureUsageDaily (ver lib/feature-usage/),
 * que soma os cliques de carona no heartbeat de presença.
 *
 * OWNER só: é dado sobre a equipe inteira, e agora também sobre cada pessoa.
 * Até 09/2026 esta tela era só por organização, de propósito; o Dono pediu a
 * quebra por pessoa ("quais pessoas e quantas vezes clicam em tais botões") —
 * o dado já existia por usuário, só faltava mostrar. Por isso continua
 * restrita ao Dono (Gerente/Supervisor não veem).
 */
export default async function UsoDoCrmPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const session = await auth();
  if (session?.user.role !== "OWNER") redirect("/configuracoes");

  const { dias } = await searchParams;
  const days = PERIOD_OPTIONS.find((d) => String(d) === dias) ?? DEFAULT_PERIOD_DAYS;

  const organizationId = session.user.organizationId!;
  const report = await runWithTenant(organizationId, () => getFeatureUsageReport(organizationId, days));

  const maxTotal = report.rows[0]?.total ?? 0;
  const maxPerson = report.people[0]?.total ?? 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        href="/configuracoes"
        className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
        Configurações
      </Link>

      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          <BarChart3 className="h-5 w-5 text-neutral-400" strokeWidth={2} />
          Uso do CRM
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Conta ações concluídas, não cliques em botão — abrir um menu e fechar sem escolher nada não entra. Só o Dono vê
          esta tela.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Período">
        <span className="mr-1 text-xs text-neutral-500 dark:text-neutral-400">Período:</span>
        {PERIOD_OPTIONS.map((option) => (
          <Link
            key={option}
            href={`/configuracoes/uso?dias=${option}`}
            aria-current={option === days ? "true" : undefined}
            className={option === days ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
          >
            {option} dias
          </Link>
        ))}
      </div>

      {report.empty ? (
        // Sem isso, a tela mostraria "todo recurso com zero" logo depois de
        // ligar a medição — parece conclusão ("ninguém usa nada"), quando na
        // verdade é só ausência de dado ainda.
        <div className="card flex items-start gap-2.5 p-4 text-sm text-neutral-500 dark:text-neutral-400">
          <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
          <div>
            <p className="font-medium text-neutral-800 dark:text-neutral-200">Ainda sem dados neste período</p>
            <p className="mt-0.5">
              Os números aparecem conforme a equipe for usando o CRM — o envio acontece a cada 30 segundos, junto do sinal
              de presença que já existia. Ações novas só passam a contar depois que o sistema for atualizado.
            </p>
          </div>
        </div>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Por funcionalidade</h2>
            <div className="card divide-y divide-neutral-100 dark:divide-neutral-800">
              {report.rows.map((row) => (
                <details key={row.feature} className="group">
                  <summary className="cursor-pointer list-none space-y-1.5 p-3 [&::-webkit-details-marker]:hidden">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-neutral-800 dark:text-neutral-200">
                        <ChevronRight
                          className="h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform group-open:rotate-90"
                          strokeWidth={2.5}
                        />
                        {row.label}
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                        {fmt(row.total)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 pl-5">
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                        <div
                          className="h-full rounded-full bg-brand"
                          style={{ width: `${maxTotal > 0 ? Math.max((row.total / maxTotal) * 100, 2) : 0}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">
                        {row.userCount === 1 ? "1 pessoa" : `${row.userCount} pessoas`}
                      </span>
                    </div>
                  </summary>
                  <ul className="space-y-1 border-t border-neutral-100 bg-neutral-50/60 px-3 py-2 pl-8 dark:border-neutral-800 dark:bg-neutral-900/40">
                    {row.people.map((person) => (
                      <li key={person.userId} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate text-neutral-700 dark:text-neutral-300">{person.name}</span>
                        <span className="shrink-0 tabular-nums text-neutral-900 dark:text-neutral-100">
                          {fmt(person.count)} {person.count === 1 ? "vez" : "vezes"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Por pessoa</h2>
            <div className="card divide-y divide-neutral-100 dark:divide-neutral-800">
              {report.people.map((person) => (
                <details key={person.userId} className="group">
                  <summary className="cursor-pointer list-none space-y-1.5 p-3 [&::-webkit-details-marker]:hidden">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-neutral-800 dark:text-neutral-200">
                        <ChevronRight
                          className="h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform group-open:rotate-90"
                          strokeWidth={2.5}
                        />
                        <span className="truncate">{person.name}</span>
                        {!person.active && (
                          <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-normal text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                            inativo
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                        {fmt(person.total)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 pl-5">
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                        <div
                          className="h-full rounded-full bg-brand"
                          style={{ width: `${maxPerson > 0 ? Math.max((person.total / maxPerson) * 100, 2) : 0}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">
                        {person.features.length === 1 ? "1 funcionalidade" : `${person.features.length} funcionalidades`}
                      </span>
                    </div>
                  </summary>
                  <ul className="space-y-1 border-t border-neutral-100 bg-neutral-50/60 px-3 py-2 pl-8 dark:border-neutral-800 dark:bg-neutral-900/40">
                    {person.features.map((feature) => (
                      <li key={feature.feature} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate text-neutral-700 dark:text-neutral-300">{feature.label}</span>
                        <span className="shrink-0 tabular-nums text-neutral-900 dark:text-neutral-100">
                          {fmt(feature.count)} {feature.count === 1 ? "vez" : "vezes"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </section>
        </>
      )}

      {report.idle.length > 0 && (
        <div className="card space-y-2 p-4">
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Sem nenhuma ação medida em {days} dias
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Membros ativos que não aparecem em nenhuma funcionalidade medida. Pode ser que usem só o que ainda não é
            medido, ou que estejam de folga — vale conversar antes de tirar conclusão.
          </p>
          <ul className="space-y-1 pt-1">
            {report.idle.map((person) => (
              <li key={person.userId} className="text-sm text-neutral-600 dark:text-neutral-300">
                · {person.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.unused.length > 0 && (
        <div className="card space-y-2 p-4">
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Sem nenhum uso em {days} dias</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Isto não quer dizer que o recurso é inútil — pode estar escondido, confuso ou quebrado. Vale perguntar pra
            equipe antes de remover.
          </p>
          <ul className="space-y-1 pt-1">
            {report.unused.map((item) => (
              <li key={item.feature} className="text-sm text-neutral-500 dark:text-neutral-400">
                · {item.label}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-neutral-400 dark:text-neutral-500">
        Medição parcial de propósito: só entram as ações listadas em lib/feature-usage/features.ts (Pipeline, Clientes,
        Negócio, Propostas, Agenda, WhatsApp, Campanhas, Scripts, ditado por voz, pedido de lead, Relatórios e busca
        geral). Um recurso que não aparece aqui ainda não é medido. Perda aceita: o que estava no navegador quando a aba
        foi fechada pode não ter sido contado.
      </p>
    </div>
  );
}
