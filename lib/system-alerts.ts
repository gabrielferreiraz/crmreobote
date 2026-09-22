import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { sendEmail } from "@/lib/email";
import { isEmailNotificationEnabled } from "@/lib/notification-settings";

/**
 * Alerta de infraestrutura (cron quebrou, backup falhou) — vai pra Dono
 * ATIVO de toda organização que não tenha desligado o interruptor
 * "cronAlerts" (ver lib/notification-settings.ts), e dentro dela só quem não
 * tiver excluído a si mesmo (OrganizationUser.receiveCronAlerts) — pedido
 * explícito depois de dono não-técnico reclamar de receber e-mail de "cron
 * parou de rodar". Nunca lança exceção — quem chama (lib/cron-run.ts) já
 * está dentro do tratamento de uma falha, uma falha AQUI não pode mascarar a
 * original.
 */
export async function sendSystemAlert(subject: string, html: string): Promise<void> {
  try {
    // Organization não tem RLS (ver prisma/schema.prisma) — listar aqui é
    // seguro fora de qualquer contexto de tenant, mesmo padrão já usado por
    // runAutomations/runCampaigns/runWebhookDeliveries pra varrer todas as
    // organizações. OrganizationUser TEM RLS, por isso o findMany de dono
    // precisa rodar por dentro de runWithTenant, uma organização de cada vez.
    const organizations = await prisma.organization.findMany({ select: { id: true } });

    const ownerLists = await Promise.all(
      organizations.map((org) =>
        runWithTenant(org.id, async () => {
          if (!(await isEmailNotificationEnabled(org.id, "cronAlerts"))) return [];
          return prisma.organizationUser.findMany({
            where: { role: "OWNER", active: true, receiveCronAlerts: true },
            select: { user: { select: { email: true } } },
          });
        }),
      ),
    );

    const emails = Array.from(new Set(ownerLists.flat().map((m) => m.user.email).filter(Boolean)));
    if (emails.length === 0) return;

    await sendEmail({ to: emails, subject, html });
  } catch (err) {
    console.error("[system-alerts] falha ao montar/enviar alerta de sistema", err);
  }
}
