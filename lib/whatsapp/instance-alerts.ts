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
import { prisma } from "@/lib/prisma";
import { resolveUserAndOrgOwners, type ResolvedRecipients } from "@/lib/notify-recipients";
import { escapeHtml } from "@/lib/security/html-escape";
import { isEmailNotificationEnabled } from "@/lib/notification-settings";
import type { $Enums } from "@/app/generated/prisma/client";

type InstanceRef = {
  id: string;
  organizationId: string;
  kind: $Enums.WhatsAppInstanceKind;
  personalOwnerId: string | null;
  instanceName: string;
  phoneNumber: string | null;
};

async function resolveRecipients(instance: InstanceRef): Promise<ResolvedRecipients | null> {
  if (instance.kind !== "PERSONAL" || !instance.personalOwnerId) return null;
  const resolved = await resolveUserAndOrgOwners(instance.organizationId, instance.personalOwnerId);
  if (!resolved) {
    console.error(`[wa:alert] instância ${instance.instanceName} sem usuário dono (personalOwnerId=${instance.personalOwnerId})`);
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
  if (!(await isEmailNotificationEnabled(instance.organizationId, "whatsappConnected"))) return;
  const resolved = await resolveRecipients(instance);
  if (!resolved) return;

  // resolved.name é User.name — editável pelo próprio usuário, então precisa
  // ser escapado antes de virar HTML (o assunto do e-mail é texto puro, não
  // precisa). Sem isso, alguém podia colocar `<a href="...">` no próprio
  // nome e injetar link/HTML num e-mail que os OWNERs tratam como confiável.
  const safeName = escapeHtml(resolved.name);
  const phoneLabel = instance.phoneNumber ? ` (${escapeHtml(instance.phoneNumber)})` : "";

  const html = `
    <p>O WhatsApp de <strong>${safeName}</strong>${phoneLabel} conectou ao CRM.</p>
    <p>Mensagens já estão sendo enviadas e recebidas normalmente por esse número.</p>
  `;

  await dispatch(`✅ WhatsApp de ${resolved.name} conectou`, html, resolved);
}

export async function notifyInstanceDisconnected(instance: InstanceRef): Promise<void> {
  if (!(await isEmailNotificationEnabled(instance.organizationId, "whatsappDisconnected"))) return;
  const resolved = await resolveRecipients(instance);
  if (!resolved) return;

  const appUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "";
  const reconnectUrl = `${appUrl}/configuracoes`;
  const safeName = escapeHtml(resolved.name);
  const phoneLabel = instance.phoneNumber ? ` (${escapeHtml(instance.phoneNumber)})` : "";

  const html = `
    <p>O WhatsApp de <strong>${safeName}</strong>${phoneLabel} desconectou do CRM.</p>
    <p>Enquanto estiver desconectado, mensagens não são enviadas nem recebidas pelo CRM pra esse número.</p>
    <p>As campanhas em andamento neste WhatsApp ficam pausadas automaticamente até ele reconectar — nenhum contato da fila é perdido.</p>
    <p><a href="${reconnectUrl}">Reconectar agora</a> (Configurações → Perfil → WhatsApp).</p>
  `;

  await dispatch(`⚠️ WhatsApp de ${resolved.name} desconectou`, html, resolved);
}

/** Dono(s) + gerentes ativos — destinatários dos alertas da Central (que não tem dono pessoal). */
async function resolveCentralRecipients(organizationId: string): Promise<ResolvedRecipients | null> {
  const rows = await prisma.organizationUser.findMany({
    where: { organizationId, active: true, role: { in: ["OWNER", "MANAGER"] } },
    select: { user: { select: { name: true, email: true } } },
  });
  if (rows.length === 0) return null;
  const recipients = new Map<string, string>();
  for (const row of rows) recipients.set(row.user.email, row.user.name);
  return { name: "Central de Leads", recipients };
}

export async function notifyCentralDisconnected(instance: InstanceRef): Promise<void> {
  if (instance.kind !== "CENTRAL") return;
  if (!(await isEmailNotificationEnabled(instance.organizationId, "whatsappDisconnected"))) return;
  const resolved = await resolveCentralRecipients(instance.organizationId);
  if (!resolved) return;

  const appUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "";
  const phoneLabel = instance.phoneNumber ? ` (${escapeHtml(instance.phoneNumber)})` : "";
  const html = `
    <p>O WhatsApp da <strong>Central de Leads</strong>${phoneLabel} desconectou do CRM.</p>
    <p>Enquanto estiver desconectado, nenhum lead novo chega aos atendentes.</p>
    <p><a href="${appUrl}/whatsapp/central">Reconectar agora</a></p>
  `;
  await dispatch("⚠️ Central de Leads desconectou", html, resolved);
}

export async function notifyCentralConnected(instance: InstanceRef): Promise<void> {
  if (instance.kind !== "CENTRAL") return;
  if (!(await isEmailNotificationEnabled(instance.organizationId, "whatsappConnected"))) return;
  const resolved = await resolveCentralRecipients(instance.organizationId);
  if (!resolved) return;

  const phoneLabel = instance.phoneNumber ? ` (${escapeHtml(instance.phoneNumber)})` : "";
  const html = `
    <p>O WhatsApp da <strong>Central de Leads</strong>${phoneLabel} conectou ao CRM.</p>
    <p>Os leads voltaram a ser distribuídos normalmente.</p>
  `;
  await dispatch("✅ Central de Leads conectou", html, resolved);
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
  // Mesma chave que a desconexão inicial acima — são o mesmo evento
  // escalando, não faria sentido silenciar um e continuar mandando o outro.
  if (!(await isEmailNotificationEnabled(instance.organizationId, "whatsappDisconnected"))) return;
  const resolved = await resolveRecipients(instance);
  if (!resolved) return;

  const appUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "";
  const reconnectUrl = `${appUrl}/configuracoes`;
  const safeName = escapeHtml(resolved.name);
  const phoneLabel = instance.phoneNumber ? ` (${escapeHtml(instance.phoneNumber)})` : "";
  const copy = ESCALATION_COPY[days];

  const html = `
    <p>O WhatsApp de <strong>${safeName}</strong>${phoneLabel} continua desconectado do CRM.</p>
    <p>${copy.tone}</p>
    <p><a href="${reconnectUrl}">Reconectar agora</a> (Configurações → Perfil → WhatsApp).</p>
  `;

  await dispatch(`${copy.emoji} WhatsApp de ${resolved.name} — ${days} dia(s) desconectado`, html, resolved);
}
