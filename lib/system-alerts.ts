import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { sendEmail } from "@/lib/email";

/**
 * Alerta de infraestrutura (cron quebrou, backup falhou) — vai pra TODO
 * Dono ATIVO de TODA organização, não só uma: um cron compartilhado
 * quebrado (automations/campaigns/db-backup/webhooks/whatsapp-health) afeta
 * todo mundo que usa este mesmo deploy igual, não é um problema de uma
 * organização específica. Nunca lança exceção — quem chama (lib/cron-run.ts)
 * já está dentro do tratamento de uma falha, uma falha AQUI não pode
 * mascarar a original.
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
        runWithTenant(org.id, () =>
          prisma.organizationUser.findMany({
            where: { role: "OWNER", active: true },
            select: { user: { select: { email: true } } },
          }),
        ),
      ),
    );

    const emails = Array.from(new Set(ownerLists.flat().map((m) => m.user.email).filter(Boolean)));
    if (emails.length === 0) return;

    await sendEmail({ to: emails, subject, html });
  } catch (err) {
    console.error("[system-alerts] falha ao montar/enviar alerta de sistema", err);
  }
}
