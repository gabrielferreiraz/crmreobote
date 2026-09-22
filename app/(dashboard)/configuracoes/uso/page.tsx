import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BarChart3, Info } from "lucide-react";
import { auth } from "@/lib/auth";
import { runWithTenant } from "@/lib/tenant-context";
import { getFeatureUsageReport } from "@/lib/feature-usage/queries";

export const dynamic = "force-dynamic";

const PERIOD_DAYS = 30;

/**
 * "Uso do CRM" — quais recursos a equipe mais usa e quais ninguém abre.
 * Alimentado por FeatureUsageDaily (ver lib/feature-usage/), que soma os
 * cliques de carona no heartbeat de presença.
 *
 * OWNER só: é dado sobre a equipe inteira, usado pra decidir produto.
 *
 * Por ORGANIZAÇÃO, sem coluna "por pessoa", de propósito — ver o comentário
 * de getFeatureUsageReport: a pergunta aqui é "onde melhorar o CRM", que se
 * responde com o total da equipe. "Quem está usando o CRM" é outra
 * pergunta e já tem tela própria (Relatórios → Atividade da equipe).
 */
export default async function UsoDoCrmPage() {
  const session = await auth();
  if (session?.user.role !== "OWNER") redirect("/configuracoes");

  const organizationId = session.user.organizationId!;
  const report = await runWithTenant(organizationId, () => getFeatureUsageReport(organizationId, PERIOD_DAYS));

  const maxTotal = report.rows[0]?.total ?? 0;

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
          Últimos {PERIOD_DAYS} dias. Conta ações concluídas, não cliques em botão — abrir um menu e fechar sem escolher
          nada não entra.
        </p>
      </div>

      {report.empty ? (
        // Sem isso, a tela mostraria "todo recurso com zero" logo depois de
        // ligar a medição — parece conclusão ("ninguém usa nada"), quando na
        // verdade é só ausência de dado ainda.
        <div className="card flex items-start gap-2.5 p-4 text-sm text-neutral-500 dark:text-neutral-400">
          <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
          <div>
            <p className="font-medium text-neutral-800 dark:text-neutral-200">Ainda sem dados</p>
            <p className="mt-0.5">
              A medição acabou de ser ligada. Os números aparecem conforme a equipe for usando o CRM — o envio acontece
              a cada 30 segundos, junto do sinal de presença que já existia.
            </p>
          </div>
        </div>
      ) : (
        <div className="card divide-y divide-neutral-100 dark:divide-neutral-800">
          {report.rows.map((row) => (
            <div key={row.feature} className="space-y-1.5 p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-sm font-medium text-neutral-800 dark:text-neutral-200">{row.label}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                  {row.total.toLocaleString("pt-BR")}
                </span>
              </div>
              <div className="flex items-center gap-2">
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
            </div>
          ))}
        </div>
      )}

      {report.unused.length > 0 && (
        <div className="card space-y-2 p-4">
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Sem nenhum uso em {PERIOD_DAYS} dias
          </p>
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
        Medição parcial de propósito: hoje só o Pipeline e a busca geral estão instrumentados (ver
        lib/feature-usage/features.ts). Um recurso que não aparece em nenhuma das duas listas ainda não é medido.
      </p>
    </div>
  );
}
