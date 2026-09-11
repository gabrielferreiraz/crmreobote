import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock3, TriangleAlert } from "lucide-react";
import { auth } from "@/lib/auth";
import { runWithTenant } from "@/lib/tenant-context";
import { getCampaignDetail } from "@/lib/campaigns/list";
import { getCronStaleness, CAMPAIGNS_CRON_NAME, CAMPAIGNS_CRON_MAX_STALE_MINUTES } from "@/lib/cron-watchdog";
import { RecipientsTable } from "./recipients-table";
import { CampaignMetricsChart } from "./metrics-chart";
import { CampaignActions } from "./campaign-actions";
import { NextSendCountdown } from "./next-send-countdown";

function formatHours(hours: number): string {
  if (hours <= 0) return "0h";
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return minutes > 0 ? `${whole}h${minutes}min` : `${whole}h`;
}

function formatDelay(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}min`;
}

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  return runWithTenant(organizationId, async () => {
    const campaign = await getCampaignDetail(organizationId, id);
    if (!campaign) notFound();

    const total = campaign.counts.pending + campaign.counts.sent + campaign.counts.failed + campaign.counts.skipped;
    const notSent = campaign.counts.pending + campaign.counts.failed + campaign.counts.skipped;
    const replyRate = campaign.counts.sent > 0 ? Math.round((campaign.counts.replied / campaign.counts.sent) * 100) : 0;
    const { completionEstimate } = campaign;

    // Só checa quando faz diferença de verdade: campanha rodando com gente
    // pendente (envio inicial OU reenvio automático em fila) é exatamente o
    // cenário em que o cron parado (job desativado no cron-job.org — ver
    // lib/cron-watchdog.ts) faz a Estimativa/contagem regressiva abaixo
    // mentir (mostra um horário que nunca vai se cumprir sozinho). Inclui
    // pendingFollowUpCount de propósito — antes só olhava o envio inicial,
    // então uma campanha já na "fase de follow-up" (envio inicial 100%
    // feito, só esperando reenvio) nunca acionava esse aviso, mesmo com o
    // mesmo cron parado. Pedido explícito: mostrar isso aqui na tela, não só
    // mandar e-mail de alerta pro Dono — quem está aqui olhando o painel
    // também precisa saber.
    const showAutoSendInfo = campaign.status === "RUNNING" && (campaign.counts.pending > 0 || campaign.pendingFollowUpCount > 0);
    const cronStatus = showAutoSendInfo
      ? await getCronStaleness(CAMPAIGNS_CRON_NAME, CAMPAIGNS_CRON_MAX_STALE_MINUTES)
      : null;

    return (
      <div className="space-y-4">
        <Link
          href="/whatsapp/campanhas"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          Campanhas
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{campaign.name}</h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{campaign.audienceLabel}</p>
          </div>
          <CampaignActions
            id={campaign.id}
            status={campaign.status}
            hasAudienceFilter={
              campaign.audienceFilter.jobTitles.length > 0 ||
              campaign.audienceFilter.tags.length > 0 ||
              campaign.audienceFilter.cities.length > 0
            }
            hasRmktWaves={campaign.hasRmktWaves}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="card p-3">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Total</p>
            <p className="text-xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{total}</p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Enviados</p>
            <p className="text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{campaign.counts.sent}</p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Não enviados</p>
            <p className="text-xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
              {notSent}
              {campaign.counts.failed > 0 && <span className="ml-1 text-sm font-normal text-red-500">({campaign.counts.failed} falhas)</span>}
            </p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Responderam</p>
            <p className="text-xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
              {campaign.counts.replied}
              <span className="ml-1 text-sm font-normal text-neutral-400 dark:text-neutral-500">({replyRate}%)</span>
            </p>
          </div>
        </div>

        {cronStatus?.stale && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-500/10 dark:text-amber-300">
            <TriangleAlert className="h-4 w-4 shrink-0" strokeWidth={2} />
            <span>
              <strong>Envio automático parado</strong> — o disparador não roda{" "}
              {cronStatus.minutesSinceLastRun === null
                ? "há muito tempo"
                : `há ${Math.round(cronStatus.minutesSinceLastRun)} min`}{" "}
              (esperado a cada 1-2min). Os horários abaixo (envio inicial e reenvio) não vão se cumprir sozinhos —
              use &quot;Enviar agora&quot; ou avise quem administra o sistema.
            </span>
          </div>
        )}

        {campaign.counts.pending > 0 && (
          <div className="card space-y-2 p-3 text-sm text-neutral-600 dark:text-neutral-300">
            <div className="flex flex-wrap items-center gap-2">
              <Clock3 className="h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
              <span className="font-medium">Estimativa de conclusão:</span>
              {completionEstimate.completionAt ? (
                <span>
                  {new Date(completionEstimate.completionAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                </span>
              ) : (
                <span className="text-neutral-400 dark:text-neutral-500">Não foi possível estimar (config. de horário/dias inválida)</span>
              )}
              <span className="text-neutral-400 dark:text-neutral-500">
                · ~{Math.max(1, Math.round(completionEstimate.leadsPerDay))} leads/dia · janela de {formatHours(completionEstimate.windowHoursPerDay)}/dia ·
                delay médio de {formatDelay(completionEstimate.avgDelaySec)}
              </span>
            </div>
            {campaign.nextSendEstimateAt && (
              <NextSendCountdown targetAt={campaign.nextSendEstimateAt.toISOString()} />
            )}
          </div>
        )}

        {/* Pedido explícito: "não mostra quando vai começar a fase de
            follow-up" — antes disso não existia nenhum horário previsto pra
            reenvio em lugar nenhum da tela, só o rótulo genérico "Fase de
            follow-up" no status (ver campaigns-table.tsx), sem dizer QUANDO.
            Card próprio (não reaproveita o de cima) porque os dois podem
            aparecer juntos: o disparo inicial ainda pode estar rolando (uns
            poucos PENDING) enquanto os já enviados há tempo suficiente já
            entraram na fila de reenvio. Cobre os DOIS mecanismos que a
            engine processa (ver pendingFollowUpCount em
            lib/campaigns/list.ts) — followUpEnabled (reenvio único) E
            rmktWaves (várias ondas, campanhas LEAD_CAPTURE); antes disso
            campanha com RMKT configurado (não followUpEnabled) nunca
            acionava este card nem a coluna "Reenvio" da tabela, mesmo
            enviando onda de verdade sozinha (relatado: "está sendo enviado
            o rmkt porque foi programado e não foi ainda parece" — a engine
            estava certa, só a tela não sabia mostrar). */}
        {(campaign.followUpEnabled || campaign.hasRmktWaves) && campaign.pendingFollowUpCount > 0 && (
          <div className="card space-y-1 p-3 text-sm text-neutral-600 dark:text-neutral-300">
            <div className="flex flex-wrap items-center gap-2">
              <Clock3 className="h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
              <span className="font-medium">Fase de follow-up:</span>
              <span>
                {campaign.pendingFollowUpCount} destinatário{campaign.pendingFollowUpCount === 1 ? "" : "s"} sem resposta aguardando reenvio
                automático
              </span>
            </div>
            {campaign.nextFollowUpEstimateAt && (
              <NextSendCountdown targetAt={campaign.nextFollowUpEstimateAt.toISOString()} label="Próximo reenvio estimado" />
            )}
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              {campaign.hasRmktWaves
                ? "Reenvia sozinho pra quem não respondeu, seguindo as ondas de remarketing configuradas — veja o previsto de cada pessoa na coluna “Reenvio” abaixo."
                : `Reenvia sozinho pra quem não respondeu, ${formatHours(campaign.followUpDelayHours)} depois do envio inicial de cada um — veja o previsto de cada pessoa na coluna "Reenvio" abaixo.`}
            </p>
          </div>
        )}

        <CampaignMetricsChart data={campaign.dailyMetrics} />

        <RecipientsTable
          recipients={campaign.recipients.map((r) => ({
            ...r,
            sentAt: r.sentAt?.toISOString() ?? null,
            repliedAt: r.repliedAt?.toISOString() ?? null,
            followUpSentAt: r.followUpSentAt?.toISOString() ?? null,
            nextFollowUpAt: r.nextFollowUpAt?.toISOString() ?? null,
          }))}
        />
      </div>
    );
  });
}
