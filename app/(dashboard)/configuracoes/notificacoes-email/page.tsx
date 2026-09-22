import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getEmailNotificationSettings } from "@/lib/notification-settings";
import { EmailNotificationsForm } from "./email-notifications-form";
import { CronAlertRecipientsForm } from "./cron-alert-recipients-form";

export default async function EmailNotificationsSettingsPage() {
  const session = await auth();
  if (session?.user.role !== "OWNER") {
    redirect("/configuracoes");
  }

  const organizationId = session.user.organizationId!;

  return runWithTenant(organizationId, async () => {
    const [settings, owners] = await Promise.all([
      getEmailNotificationSettings(organizationId),
      prisma.organizationUser.findMany({
        where: { role: "OWNER", active: true },
        orderBy: { user: { name: "asc" } },
        select: { id: true, receiveCronAlerts: true, user: { select: { id: true, name: true, email: true } } },
      }),
    ]);

    return (
      <div className="mx-auto max-w-lg space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Alertas por e-mail
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Escolha quais avisos automáticos o CRM manda por e-mail. Desligado aqui não manda
            pra ninguém — nem pra você, nem pros outros donos da conta.
          </p>
        </div>
        <EmailNotificationsForm initial={settings} />
        {/* "Alertas de cron" é o único item acima com granularidade extra —
            os outros (WhatsApp, senha) já são eventos que qualquer dono quer
            saber; este é técnico e pode não interessar a todo mundo, ver
            comentário em lib/notification-settings.ts. */}
        {owners.length > 1 && <CronAlertRecipientsForm initial={owners} />}
      </div>
    );
  });
}
