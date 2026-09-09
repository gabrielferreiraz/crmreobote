import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { runWithTenant } from "@/lib/tenant-context";
import { getEmailNotificationSettings } from "@/lib/notification-settings";
import { EmailNotificationsForm } from "./email-notifications-form";

export default async function EmailNotificationsSettingsPage() {
  const session = await auth();
  if (session?.user.role !== "OWNER") {
    redirect("/configuracoes");
  }

  const organizationId = session.user.organizationId!;

  return runWithTenant(organizationId, async () => {
    const settings = await getEmailNotificationSettings(organizationId);

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
      </div>
    );
  });
}
