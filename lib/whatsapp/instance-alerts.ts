/**
 * Alerta por e-mail quando o WhatsApp de um vendedor desconecta — tanto o
 * próprio vendedor quanto o(s) dono(s) (OWNER) da organização recebem,
 * porque a conexão cair impacta o atendimento de leads dele diretamente e é
 * algo que o dono da conta precisa saber pra cobrar reconexão.
 *
 * A desconexão gera um aviso imediato e depois escala enquanto continuar
 * desconectado: 1 dia, 2 dias, 3 dias (o último, mais urgente — não manda
 * mais nada depois disso). Quem decide QUANDO escalar é o cron de saúde
 * (lib/whatsapp/health-check.ts), que compara `disconnectedAt` com agora;
 * este arquivo só sabe montar e mandar o e-mail certo pra cada nível.
 */

import { sendEmail } from "@/lib/email";
import { resolveUserAndOrgOwners, type ResolvedRecipients } from "@/lib/notify-recipients";

type InstanceRef = {
  id: string;
  organizationId: string;
  userId: string;
  instanceName: string;
  phoneNumber: string | null;
};

async function resolveRecipients(instance: InstanceRef): Promise<ResolvedRecipients | null> {
  const resolved = await resolveUserAndOrgOwners(instance.organizationId, instance.userId);
  if (!resolved) {
    console.error(`[wa:alert] instância ${instance.instanceName} sem usuário dono (userId=${instance.userId})`);
  }
  return resolved;
}

async function dispatch(subject: string, html: string, resolved: ResolvedRecipients) {
  const result = await sendEmail({ to: Array.from(resolved.recipients.keys()), subject, html });
  if (result.ok) {
    console.log(`[wa:alert] "${subject}" enviado para: ${Array.from(resolved.recipients.keys()).join(", ")}`);
  } else {
    console.error(`[wa:alert] falha ao enviar "${subject}": ${result.error}`);
  }
}

/** Disparado na transição pra CONNECTED (primeira conexão ou reconexão) — avisa que o número voltou a atender. */
export async function notifyInstanceConnected(instance: InstanceRef): Promise<void> {
  const resolved = await resolveRecipients(instance);
  if (!resolved) return;

  const phoneLabel = instance.phoneNumber ? ` (${instance.phoneNumber})` : "";

  const html = `
    <p>O WhatsApp de <strong>${resolved.name}</strong>${phoneLabel} conectou ao CRM.</p>
    <p>Mensagens já estão sendo enviadas e recebidas normalmente por esse número.</p>
  `;

  await dispatch(`✅ WhatsApp de ${resolved.name} conectou`, html, resolved);
}

export async function notifyInstanceDisconnected(instance: InstanceRef): Promise<void> {
  const resolved = await resolveRecipients(instance);
  if (!resolved) return;

  const appUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "";
  const reconnectUrl = `${appUrl}/configuracoes`;
  const phoneLabel = instance.phoneNumber ? ` (${instance.phoneNumber})` : "";

  const html = `
    <p>O WhatsApp de <strong>${resolved.name}</strong>${phoneLabel} desconectou do CRM.</p>
    <p>Enquanto estiver desconectado, mensagens não são enviadas nem recebidas pelo CRM pra esse número.</p>
    <p><a href="${reconnectUrl}">Reconectar agora</a> (Configurações → Perfil → WhatsApp).</p>
  `;

  await dispatch(`⚠️ WhatsApp de ${resolved.name} desconectou`, html, resolved);
}

const ESCALATION_COPY: Record<number, { emoji: string; tone: string }> = {
  1: { emoji: "⚠️", tone: "Já faz <strong>1 dia</strong> que o WhatsApp está desconectado." },
  2: { emoji: "⚠️", tone: "Já faz <strong>2 dias</strong> que o WhatsApp está desconectado." },
  3: {
    emoji: "🚨",
    tone: "Já faz <strong>3 dias</strong> que o WhatsApp está desconectado. Esse é o último aviso automático — reconecte o quanto antes pra não perder leads.",
  },
};

/** `days` é 1, 2 ou 3 — outros valores não têm cópia definida e não devem ser chamados. */
export async function notifyInstanceStillDisconnected(instance: InstanceRef, days: 1 | 2 | 3): Promise<void> {
  const resolved = await resolveRecipients(instance);
  if (!resolved) return;

  const appUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "";
  const reconnectUrl = `${appUrl}/configuracoes`;
  const phoneLabel = instance.phoneNumber ? ` (${instance.phoneNumber})` : "";
  const copy = ESCALATION_COPY[days];

  const html = `
    <p>O WhatsApp de <strong>${resolved.name}</strong>${phoneLabel} continua desconectado do CRM.</p>
    <p>${copy.tone}</p>
    <p><a href="${reconnectUrl}">Reconectar agora</a> (Configurações → Perfil → WhatsApp).</p>
  `;

  await dispatch(`${copy.emoji} WhatsApp de ${resolved.name} — ${days} dia(s) desconectado`, html, resolved);
}
