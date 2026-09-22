/**
 * Preferência de e-mail automático por organização — pedido explícito do
 * usuário: escolher o que o CRM manda por e-mail (WhatsApp conectou/
 * desconectou, senha alterada) e o que não manda, em vez de todo alerta
 * disparar sempre sem controle nenhum. Guardado em
 * Organization.emailNotificationSettings (ver schema.prisma), lido só por
 * `isEmailNotificationEnabled` — os pontos que hoje mandam esse tipo de
 * e-mail (lib/whatsapp/instance-alerts.ts, app/api/org/members/[userId]/
 * reset-password/route.ts) chamam essa função antes de enviar.
 *
 * A chave "cronAlerts" TAMBÉM controla lib/system-alerts.ts (falha de
 * cron/backup) — apesar de ser um alerta de infraestrutura que varre TODAS
 * as organizações do deploy, cada organização decide, pro PRÓPRIO conjunto
 * de donos, se recebe ou não (pedido explícito depois de um dono não-técnico
 * reclamar de receber e-mail de "cron parou de rodar"). Desligado aqui =
 * nenhum dono desta organização recebe, mesmo que OrganizationUser.
 * receiveCronAlerts esteja true neles. Ligado = cada dono decide pra si via
 * esse campo (ver app/(dashboard)/configuracoes/notificacoes-email/
 * cron-alert-recipients-form.tsx).
 *
 * Fora daqui de propósito:
 * - Ação "Enviar e-mail" de automação (lib/automations/engine.ts) — já se
 *   controla ativando/desativando a própria regra.
 *
 * Reexporta EmailNotificationKey/EMAIL_NOTIFICATION_OPTIONS de
 * notification-settings-constants.ts por compatibilidade — mas componente
 * "use client" deve importar de lá diretamente (ver comentário nesse
 * arquivo: importar daqui no cliente arrasta `pg` pro bundle do navegador).
 */

import { prisma } from "@/lib/prisma";
import { EMAIL_NOTIFICATION_OPTIONS, type EmailNotificationKey } from "@/lib/notification-settings-constants";

export { EMAIL_NOTIFICATION_OPTIONS, type EmailNotificationKey };

// Chave ausente do JSON salvo = ligado (comportamento de sempre, antes desta
// configuração existir — ninguém que já dependia desses e-mails fica sem
// avisar do nada só por essa feature ter sido adicionada).
const DEFAULT_ENABLED: Record<EmailNotificationKey, true> = {
  whatsappConnected: true,
  whatsappDisconnected: true,
  passwordChanged: true,
  cronAlerts: true,
};

type StoredSettings = Partial<Record<EmailNotificationKey, boolean>>;

export async function getEmailNotificationSettings(organizationId: string): Promise<Record<EmailNotificationKey, boolean>> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { emailNotificationSettings: true },
  });
  const stored = (organization?.emailNotificationSettings as StoredSettings | null) ?? {};
  const result = {} as Record<EmailNotificationKey, boolean>;
  for (const { key } of EMAIL_NOTIFICATION_OPTIONS) {
    result[key] = stored[key] ?? DEFAULT_ENABLED[key];
  }
  return result;
}

/** Usado pelos pontos de envio antes de chamar sendEmail — nunca lança (falha ao ler a configuração não pode impedir o alerta, cai no padrão "ligado"). */
export async function isEmailNotificationEnabled(organizationId: string, key: EmailNotificationKey): Promise<boolean> {
  try {
    const settings = await getEmailNotificationSettings(organizationId);
    return settings[key];
  } catch (err) {
    console.error(`[notification-settings] falha ao ler preferência "${key}", seguindo com padrão (ligado)`, err);
    return true;
  }
}
