import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CalendarClock, MessageSquare, MessagesSquare, Snowflake } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { listBackupMembers } from "@/lib/whatsapp/backup";
import { formatCount, formatPeriod } from "@/lib/whatsapp/backup-format";
import { Avatar } from "@/components/avatar";
import { BackupExportMenu } from "@/components/whatsapp-backup/export-menu";
import { WhatsAppBackupView } from "./whatsapp-backup-view";

export const dynamic = "force-dynamic";

/**
 * Backup de mensagens de WhatsApp de um usuário específico — só o Dono
 * acessa (conversa privada de outra pessoa). Pra quem está ativo, mostra
 * todas as conversas dele; pra quem foi desativado, mostra o histórico
 * congelado até a desativação (a instância foi apagada de verdade, mas a
 * conversa sobrevive — ver ownerUserId em prisma/schema.prisma).
 */
export default async function WhatsAppBackupPage({ params }: { params: Promise<{ userId: string }> }) {
  const session = await auth();
  if (session?.user.role !== "OWNER") redirect("/configuracoes");

  const organizationId = session.user.organizationId!;
  const { userId } = await params;

  const [member, [summary]] = await Promise.all([
    runWithTenant(organizationId, () =>
      prisma.organizationUser.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
        include: { user: { select: { id: true, name: true, email: true, image: true } } },
      }),
    ),
    listBackupMembers(organizationId, userId),
  ]);
  if (!member) notFound();

  const hasBackup = Boolean(summary);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="shrink-0 space-y-3">
        <Link
          href="/configuracoes/backups"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          Backup de mensagens
        </Link>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-1 items-center gap-3.5">
            <Avatar name={member.user.name} src={member.user.image} size="lg" />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">{member.user.name}</h1>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-500 dark:text-neutral-400">
                <span className="truncate">{member.user.email}</span>
                {member.active ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Ativo
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                    <Snowflake className="h-3 w-3" strokeWidth={2.25} /> Desativado · histórico congelado
                  </span>
                )}
              </p>
            </div>
          </div>

          {hasBackup && <BackupExportMenu userId={userId} label="Exportar tudo" variant="primary" />}
        </div>

        {hasBackup && (
          <div className="flex flex-wrap gap-2 text-xs text-neutral-600 dark:text-neutral-300">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1 dark:border-neutral-700 dark:bg-neutral-900">
              <MessagesSquare className="h-3.5 w-3.5 text-neutral-400" strokeWidth={2} />
              <strong className="font-semibold tabular-nums">{formatCount(summary.threads)}</strong> {summary.threads === 1 ? "conversa" : "conversas"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1 dark:border-neutral-700 dark:bg-neutral-900">
              <MessageSquare className="h-3.5 w-3.5 text-neutral-400" strokeWidth={2} />
              <strong className="font-semibold tabular-nums">{formatCount(summary.messages)}</strong> {summary.messages === 1 ? "mensagem" : "mensagens"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1 dark:border-neutral-700 dark:bg-neutral-900">
              <CalendarClock className="h-3.5 w-3.5 text-neutral-400" strokeWidth={2} />
              {formatPeriod(summary.firstMessageAt, summary.lastMessageAt)}
            </span>
          </div>
        )}
      </div>

      <WhatsAppBackupView userId={userId} ownerName={member.user.name} />
    </div>
  );
}
