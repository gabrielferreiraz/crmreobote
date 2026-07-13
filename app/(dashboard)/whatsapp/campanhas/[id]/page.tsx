import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { runWithTenant } from "@/lib/tenant-context";
import { getCampaignDetail } from "@/lib/campaigns/list";
import { RecipientsTable } from "./recipients-table";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const isManager = session!.user.role === "OWNER" || session!.user.role === "ADMIN";

  return runWithTenant(organizationId, async () => {
    if (!isManager) {
      return (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Apenas donos e administradores podem gerenciar campanhas.
        </p>
      );
    }

    const campaign = await getCampaignDetail(organizationId, id);
    if (!campaign) notFound();

    return (
      <div className="space-y-4">
        <Link
          href="/whatsapp/campanhas"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          Campanhas
        </Link>

        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{campaign.name}</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {campaign.counts.sent} enviadas · {campaign.counts.replied} respostas · {campaign.counts.failed} falhas ·{" "}
            {campaign.counts.skipped} puladas · {campaign.counts.pending} pendentes
          </p>
        </div>

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
