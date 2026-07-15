import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock3 } from "lucide-react";
import { auth } from "@/lib/auth";
import { runWithTenant } from "@/lib/tenant-context";
import { getCampaignDetail } from "@/lib/campaigns/list";
import { RecipientsTable } from "./recipients-table";
import { CampaignMetricsChart } from "./metrics-chart";
import { CampaignActions } from "./campaign-actions";

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
  const isManager = session!.user.role === "OWNER" || session!.user.role === "MANAGER";

  return runWithTenant(organizationId, async () => {
    if (!isManager) {
      return (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Apenas donos e gerentes podem gerenciar campanhas.
        </p>
      );
    }

    const campaign = await getCampaignDetail(organizationId, id);
    if (!campaign) notFound();

    const total = campaign.counts.pending + campaign.counts.sent + campaign.counts.failed + campaign.counts.skipped;
    const notSent = campaign.counts.pending + campaign.counts.failed + campaign.counts.skipped;
    const replyRate = campaign.counts.sent > 0 ? Math.round((campaign.counts.replied / campaign.counts.sent) * 100) : 0;
    const { completionEstimate } = campaign;

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
          <CampaignActions id={campaign.id} status={campaign.status} />
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

        {campaign.counts.pending > 0 && (
          <div className="card flex flex-wrap items-center gap-2 p-3 text-sm text-neutral-600 dark:text-neutral-300">
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
        )}

        <CampaignMetricsChart data={campaign.dailyMetrics} />

        <RecipientsTable
          recipients={campaign.recipients.map((r) => ({
            ...r,
            sentAt: r.sentAt?.toISOString() ?? null,
            repliedAt: r.repliedAt?.toISOString() ?? null,
            followUpSentAt: r.followUpSentAt?.toISOString() ?? null,
          }))}
        />
      </div>
    );
  });
}
