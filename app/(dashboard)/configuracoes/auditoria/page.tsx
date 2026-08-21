import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { AuditLogView } from "./audit-log-view";

const MAX_LOGS = 500;

export default async function AuditoriaPage() {
  const session = await auth();
  if (session?.user.role !== "OWNER") redirect("/configuracoes");

  const organizationId = session.user.organizationId!;

  const logs = await runWithTenant(organizationId, () =>
    prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: MAX_LOGS,
    }),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Auditoria</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Login, chaves de API, gestão de membros e conexões (WhatsApp/Meta/Google) — últimos {MAX_LOGS} eventos.
          Visível só pra donos, pra investigar o que aconteceu se uma conta for comprometida.
        </p>
      </div>

      <AuditLogView
        initialLogs={logs.map((l) => ({
          id: l.id,
          actorName: l.actorName,
          action: l.action,
          targetType: l.targetType,
          targetId: l.targetId,
          detail: l.detail,
          ip: l.ip,
          createdAt: l.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
