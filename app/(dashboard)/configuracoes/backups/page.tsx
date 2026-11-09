import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, DatabaseBackup } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { listBackupMembers } from "@/lib/whatsapp/backup";
import { BackupsHub } from "@/components/whatsapp-backup/backups-hub";

export const dynamic = "force-dynamic";

/**
 * Backup de mensagens de WhatsApp — lista todo mundo que tem histórico guardado
 * e leva à leitura/exportação de cada um. Só o Dono (conversa privada de outra
 * pessoa); quem não é Dono volta para Configurações.
 */
export default async function BackupsPage() {
  const session = await auth();
  if (session?.user.role !== "OWNER") redirect("/configuracoes");
  const organizationId = session.user.organizationId!;

  const [members, teamSize] = await Promise.all([
    listBackupMembers(organizationId),
    runWithTenant(organizationId, () => prisma.organizationUser.count({ where: { organizationId } })),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link
          href="/configuracoes"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          Configurações
        </Link>
        <div className="mt-3 flex items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand shadow-sm shadow-brand/30">
            <DatabaseBackup className="h-6 w-6 text-white" strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Backup de mensagens</h1>
            <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
              O histórico de WhatsApp de cada consultor, guardado na nuvem. Escolha uma pessoa para ler ou exportar.
            </p>
          </div>
        </div>
      </div>

      <BackupsHub members={members} withoutBackup={Math.max(0, teamSize - members.length)} />
    </div>
  );
}
