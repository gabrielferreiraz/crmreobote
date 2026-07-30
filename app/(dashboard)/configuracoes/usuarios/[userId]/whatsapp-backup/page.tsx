import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { WhatsAppBackupView } from "./whatsapp-backup-view";

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

  return runWithTenant(organizationId, async () => {
    const member = await prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      include: { user: { select: { id: true, name: true } } },
    });
    if (!member) notFound();

    return (
      <div className="flex h-full flex-col gap-4">
        <div>
          <Link
            href="/configuracoes/usuarios"
            className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            Usuários
          </Link>
          <h1 className="mt-2 text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Backup de mensagens — {member.user.name}
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {member.active
              ? "Todas as conversas de WhatsApp deste usuário."
              : "Usuário desativado — histórico congelado até a desativação."}
          </p>
        </div>
        <WhatsAppBackupView userId={userId} />
      </div>
    );
  });
}
