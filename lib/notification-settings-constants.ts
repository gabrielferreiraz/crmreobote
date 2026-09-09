/**
 * Tipos/lista de e-mails de alerta configuráveis — separado de
 * lib/notification-settings.ts (que importa prisma) só pra poder ser
 * importado por componente "use client" sem arrastar `pg` pro bundle do
 * navegador (mesmo padrão/motivo de lib/contacts/constants.ts vs.
 * lib/contacts/list-query.ts).
 */

export type EmailNotificationKey = "whatsappConnected" | "whatsappDisconnected" | "passwordChanged";

export const EMAIL_NOTIFICATION_OPTIONS: { key: EmailNotificationKey; label: string; description: string }[] = [
  {
    key: "whatsappConnected",
    label: "WhatsApp conectado",
    description: "Quando o WhatsApp de um consultor conecta (ou reconecta) ao CRM.",
  },
  {
    key: "whatsappDisconnected",
    label: "WhatsApp desconectado",
    description: "Quando desconecta, com lembretes escalando em 1, 2 e 3 dias enquanto continuar assim.",
  },
  {
    key: "passwordChanged",
    label: "Senha alterada",
    description: "Quando a senha de algum usuário do time é alterada por um dono da conta.",
  },
];
