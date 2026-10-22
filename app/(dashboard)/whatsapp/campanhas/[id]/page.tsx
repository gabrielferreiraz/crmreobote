import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock3, TriangleAlert } from "lucide-react";
import { auth } from "@/lib/auth";
import { runWithTenant } from "@/lib/tenant-context";
import { getCampaignDetail, getCampaignRecipientsPage } from "@/lib/campaigns/list";
import { QUEUE_EDITABLE_STATUSES, getCampaignQueue } from "@/lib/campaigns/queue";
import { getCronStaleness, CAMPAIGNS_CRON_NAME, CAMPAIGNS_CRON_MAX_STALE_MINUTES } from "@/lib/cron-watchdog";
import { getDealScope } from "@/lib/team-scope";
import { getSharedScope } from "@/lib/share-groups";
import { RecipientsTable } from "./recipients-table";
import { CampaignMetricsChart } from "./metrics-chart";
import { CampaignActions } from "./campaign-actions";
import { NextSendCountdown } from "./next-send-countdown";
import { CampaignScriptsPanel } from "./campaign-scripts-panel";
import { CampaignQueue, type CampaignQueueData } from "./campaign-queue";
import { OfflineNotice, PausedNotice } from "./paused-notice";
import { PAUSE_REASON } from "@/lib/campaigns/pause-reasons";

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

function campaignStatusMeta(status: string) {
  if (status === "RUNNING") return { label: "Em andamento", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" };
  if (status === "PAUSED") return { label: "Pausada", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" };
  if (status === "DONE") return { label: "Concluída", dot: "bg-neutral-400", text: "text-neutral-600 dark:text-neutral-300" };
  return { label: "Rascunho", dot: "bg-neutral-400", text: "text-neutral-600 dark:text-neutral-300" };
}

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ destinatarios?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const initialRecipientStatus = query.destinatarios === "falhas" ? "FAILED" as const : undefined;
  const initialOnlyReplied = query.destinatarios === "respostas";
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  return runWithTenant(organizationId, async () => {
    // Mesmo escopo da lista (ver lib/team-scope.ts) — sem isso, Consultor
    // abrindo a URL de uma campanha alheia via a lista de leads (nome/
    // telefone) de outro consultor. Fora do escopo cai no mesmo 404 de "id
    // não existe" — nunca revela que a campanha existe pra quem não pode vê-la.
    const [scope, dealScope] = await Promise.all([
      getDealScope(organizationId, session!.user.id, session!.user.role),
      getSharedScope(organizationId, session!.user.id, session!.user.role, "shareDeals"),
    ]);
    // Mesmo escopo de /negocios/[id] (com grupos de compartilhamento) — o
    // "Ver negócio" da tabela só aparece pra negócio que essa pessoa abre.
    const [campaign, initialRecipients] = await Promise.all([
      getCampaignDetail(organizationId, id, scope),
      getCampaignRecipientsPage(organizationId, id, scope, dealScope, {
        limit: 50,
        status: initialRecipientStatus,
        onlyReplied: initialOnlyReplied,
      }),
    ]);
    if (!campaign || !initialRecipients) notFound();

    const total = campaign.counts.pending + campaign.counts.sent + campaign.counts.failed + campaign.counts.skipped;
    const replyRate = campaign.counts.sent > 0 ? Math.round((campaign.counts.replied / campaign.counts.sent) * 100) : 0;
    const processed = Math.max(0, total - campaign.counts.pending);
    const progress = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
    const hasAudienceFilter =
      campaign.audienceFilter.jobTitles.length > 0 ||
      campaign.audienceFilter.tags.length > 0 ||
      campaign.audienceFilter.cities.length > 0;
    const audienceLabel = hasAudienceFilter ? campaign.audienceLabel : "Lista definida para esta campanha";
    const statusMeta = campaignStatusMeta(campaign.status);
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
    const cronStatusPromise = showAutoSendInfo
      ? getCronStaleness(CAMPAIGNS_CRON_NAME, CAMPAIGNS_CRON_MAX_STALE_MINUTES)
      : Promise.resolve(null);

    // Fila de disparo (quem sai em qual horário, quem sai na próxima hora, reordenar): só pra quem
    // GERENCIA a campanha — a fila lista e reordena a campanha INTEIRA, inclusive os leads de
    // outros consultores, então quem apenas enxerga o envio (parte dos destinatários no próprio
    // WhatsApp) não recebe nem os dados. É um extra: se falhar, a página (que tem pausar/retomar)
    // abre normalmente sem ele.
    const queuePromise: Promise<CampaignQueueData | null> =
      campaign.canManage && campaign.counts.pending > 0 && campaign.status !== "DONE"
        ? getCampaignQueue(organizationId, campaign.id, { offset: 0, limit: 30 })
            .then((view) =>
              view ? { ...view, canEdit: QUEUE_EDITABLE_STATUSES.includes(view.status) } : null,
            )
            .catch((err) => {
              console.error("[campanhas] falha ao montar a fila de disparo", err);
              return null;
            })
        : Promise.resolve(null);

    const [cronStatus, queue] = await Promise.all([cronStatusPromise, queuePromise]);

    return (
      <div className="space-y-6">
        <header className="border-b border-neutral-200 pb-5 dark:border-neutral-800">
          <Link
            href="/whatsapp/campanhas"
            className="mb-4 inline-flex items-center gap-1.5 text-base text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            Campanhas
          </Link>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className={`mb-1.5 flex items-center gap-2 text-sm font-medium ${statusMeta.text}`}>
                <span className={`h-2 w-2 rounded-full ${statusMeta.dot}`} aria-hidden="true" />
                {statusMeta.label}
              </div>
              <h1 className="max-w-4xl text-xl font-semibold text-neutral-950 dark:text-white sm:text-2xl">{campaign.name}</h1>
              <p className="mt-1 text-base text-neutral-500 dark:text-neutral-400">{audienceLabel}</p>
            </div>
            {/* Só quem pode gerenciar (criador ou dono do WhatsApp da campanha) — quem
                apenas enxerga um envio em massa em que parte saiu do seu WhatsApp não
                tem pausar/enviar/duplicar. */}
            {campaign.canManage && (
              <CampaignActions
                id={campaign.id}
                status={campaign.status}
                hasAudienceFilter={hasAudienceFilter}
                hasRmktWaves={campaign.hasRmktWaves}
                autoPausedByDisconnect={campaign.status === "PAUSED" && campaign.pausedReason === PAUSE_REASON.WHATSAPP_DISCONNECTED}
              />
            )}
          </div>
        </header>

        <nav
          aria-label="Seções da campanha"
          className="sticky top-[-1rem] z-20 -mx-4 -mt-6 overflow-x-auto border-b border-neutral-200 bg-neutral-50 px-4 dark:border-neutral-800 dark:bg-neutral-950 lg:top-[-2rem] lg:-mx-8 lg:px-8"
        >
          <div className="flex min-w-max items-center gap-6">
            <a href="#visao-geral" className="border-b-2 border-transparent py-3 text-base font-medium text-neutral-600 hover:border-neutral-400 hover:text-neutral-950 dark:text-neutral-300 dark:hover:border-neutral-600 dark:hover:text-white">
              Visão geral
            </a>
            {queue && (
              <a href="#fila" className="border-b-2 border-transparent py-3 text-base font-medium text-neutral-600 hover:border-neutral-400 hover:text-neutral-950 dark:text-neutral-300 dark:hover:border-neutral-600 dark:hover:text-white">
                Fila <span className="font-normal text-neutral-400 dark:text-neutral-500">{campaign.counts.pending}</span>
              </a>
            )}
            <a href="#destinatarios" className="border-b-2 border-transparent py-3 text-base font-medium text-neutral-600 hover:border-neutral-400 hover:text-neutral-950 dark:text-neutral-300 dark:hover:border-neutral-600 dark:hover:text-white">
              Destinatários <span className="font-normal text-neutral-400 dark:text-neutral-500">{total}</span>
            </a>
            <a href="#mensagens" className="border-b-2 border-transparent py-3 text-base font-medium text-neutral-600 hover:border-neutral-400 hover:text-neutral-950 dark:text-neutral-300 dark:hover:border-neutral-600 dark:hover:text-white">
              Mensagens e desempenho
            </a>
          </div>
        </nav>

        {/* Pausada pelo PRÓPRIO motor (WhatsApp caiu, número instável, falhas seguidas): por que
            parou, se volta sozinha e o que fazer — ver lib/campaigns/instance-guard.ts. */}
        {campaign.status === "PAUSED" && campaign.pausedReason && (
          <PausedNotice reason={campaign.pausedReason} instance={campaign.pauseInstance} canManage={campaign.canManage} />
        )}
        {campaign.whatsappOffline && (
          <OfflineNotice ownerName={campaign.whatsappOffline.ownerName} disconnectedAt={campaign.whatsappOffline.disconnectedAt} />
        )}

        <section id="visao-geral" className="scroll-mt-16 overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950" aria-label="Progresso da campanha">
          <div className="p-4 sm:p-5">
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Progresso dos envios</h2>
                <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
                  {processed} de {total} contatos processados
                </p>
              </div>
              <span className="text-lg font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{progress}%</span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800"
              role="progressbar"
              aria-label="Contatos processados"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="grid grid-cols-2 border-t border-neutral-200 dark:border-neutral-800 sm:grid-cols-4">
            <div className="border-r border-b border-neutral-200 p-4 dark:border-neutral-800 sm:border-b-0">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Enviados</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{campaign.counts.sent}</p>
            </div>
            <div className="border-b border-neutral-200 p-4 dark:border-neutral-800 sm:border-r sm:border-b-0">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Na fila</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{campaign.counts.pending}</p>
            </div>
            <div className="border-r border-neutral-200 p-4 dark:border-neutral-800">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Falharam</p>
              <p className={`mt-1 text-xl font-semibold tabular-nums ${campaign.counts.failed > 0 ? "text-red-600 dark:text-red-400" : "text-neutral-900 dark:text-neutral-100"}`}>
                {campaign.counts.failed}
              </p>
              {campaign.counts.skipped > 0 && <p className="text-xs text-neutral-400 dark:text-neutral-500">{campaign.counts.skipped} ignorados</p>}
              {campaign.counts.failed > 0 && (
                <Link href={`/whatsapp/campanhas/${campaign.id}?destinatarios=falhas#destinatarios`} className="mt-1 inline-block text-sm font-medium text-red-600 hover:underline dark:text-red-400">
                  Revisar contatos
                </Link>
              )}
            </div>
            <div className="p-4">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Responderam</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                {campaign.counts.replied}
                <span className="ml-1 text-sm font-normal text-neutral-400 dark:text-neutral-500">{replyRate}%</span>
              </p>
              {campaign.counts.replied > 0 && (
                <Link href={`/whatsapp/campanhas/${campaign.id}?destinatarios=respostas#destinatarios`} className="mt-1 inline-block text-sm font-medium text-brand hover:underline">
                  Ver respostas
                </Link>
              )}
            </div>
          </div>
        </section>

        {cronStatus?.stale && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-500/10 dark:text-amber-300">
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
          <section className="grid overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 md:grid-cols-2 md:divide-x md:divide-neutral-200 md:dark:divide-neutral-800" aria-label="Próximos passos">
            <div className="border-b border-neutral-200 p-4 dark:border-neutral-800 md:border-b-0">
              <p className="mb-1.5 text-sm font-medium text-neutral-500 dark:text-neutral-400">Próximo envio</p>
              {campaign.nextSendEstimateAt ? (
                <NextSendCountdown targetAt={campaign.nextSendEstimateAt.toISOString()} label="Daqui a" />
              ) : (
                <p className="text-base text-neutral-500 dark:text-neutral-400">Aguardando uma janela de envio válida.</p>
              )}
            </div>
            <div className="p-4">
              <p className="mb-1.5 text-sm font-medium text-neutral-500 dark:text-neutral-400">Conclusão prevista</p>
              <p className="text-base font-medium text-neutral-800 dark:text-neutral-200">
                {completionEstimate.completionAt
                  ? new Date(completionEstimate.completionAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
                  : "Sem estimativa disponível"}
              </p>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                ~{Math.max(1, Math.round(completionEstimate.leadsPerDay))} por dia · janela de {formatHours(completionEstimate.windowHoursPerDay)} · intervalo médio de {formatDelay(completionEstimate.avgDelaySec)}
              </p>
            </div>
          </section>
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
          <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/50 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
              <div>
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Reenvio automático</h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  {campaign.pendingFollowUpCount} sem resposta aguardando {campaign.hasRmktWaves ? "a próxima onda" : `o intervalo de ${formatHours(campaign.followUpDelayHours)}`}.
                </p>
              </div>
            </div>
            {campaign.nextFollowUpEstimateAt && (
              <div className="shrink-0 text-base">
                <NextSendCountdown targetAt={campaign.nextFollowUpEstimateAt.toISOString()} label="Próximo reenvio" />
              </div>
            )}
          </section>
        )}

        {/* Ordem de envio dos pendentes, por horário previsto, e quem sai na próxima hora — editável
            por quem gerencia a campanha (ver campaign-queue.tsx). */}
        {queue && (
          <div id="fila" className="scroll-mt-16">
            <CampaignQueue campaignId={campaign.id} initial={queue} />
          </div>
        )}

        <section id="destinatarios" className="scroll-mt-16 space-y-3" aria-labelledby="campaign-recipients-title">
          <div className="border-b border-neutral-200 pb-3 dark:border-neutral-800">
            <h2 id="campaign-recipients-title" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Destinatários</h2>
            <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">Busque um contato, acompanhe o envio e abra as respostas.</p>
          </div>
          <RecipientsTable
            key={query.destinatarios ?? "todos"}
            campaignId={campaign.id}
            repliedTotal={campaign.counts.replied}
            initialStatusFilter={initialRecipientStatus ?? "ALL"}
            initialOnlyReplied={initialOnlyReplied}
            initialPage={{
              ...initialRecipients,
              items: initialRecipients.items.map((r) => ({
                ...r,
                sentAt: r.sentAt?.toISOString() ?? null,
                repliedAt: r.repliedAt?.toISOString() ?? null,
                followUpSentAt: r.followUpSentAt?.toISOString() ?? null,
                lastWaveSentAt: r.lastWaveSentAt?.toISOString() ?? null,
                lastWaveNumber: r.lastWaveNumber,
                nextFollowUpAt: r.nextFollowUpAt?.toISOString() ?? null,
              })),
            }}
          />
        </section>

        {/* Scripts que a campanha usa e se a cópia dela está igual à biblioteca —
            editar aqui abre o editor com "esta campanha" já marcada pra receber
            o texto novo (ver lib/campaigns/script-sync.ts). */}
        <div id="mensagens" className={`scroll-mt-16 grid items-start gap-4 ${campaign.scripts.length > 0 ? "xl:grid-cols-2" : ""}`}>
          <CampaignMetricsChart data={campaign.dailyMetrics} />
          <CampaignScriptsPanel campaignId={campaign.id} scripts={campaign.scripts} editable={campaign.scriptsEditable} />
        </div>
      </div>
    );
  });
}
