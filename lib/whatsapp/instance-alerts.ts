/**
 * Alerta por e-mail quando o WhatsApp de um vendedor desconecta — tanto o
 * próprio vendedor quanto o(s) dono(s) (OWNER) da organização recebem,
 * porque a conexão cair impacta o atendimento de leads dele diretamente e é
 * algo que o dono da conta precisa saber pra cobrar reconexão.
 */

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

type InstanceRef = {
  id: string;
  organizationId: string;
  userId: string;
  instanceName: string;
  phoneNumber: string | null;
};

export async function notifyInstanceDisconnected(instance: InstanceRef): Promise<void> {
  const [owner, orgOwners] = await Promise.all([
    prisma.user.findUnique({ where: { id: instance.userId }, select: { name: true, email: true } }),
    prisma.organizationUser.findMany({
      where: { organizationId: instance.organizationId, role: "OWNER", active: true },
      include: { user: { select: { name: true, email: true } } },
    }),
  ]);

  if (!owner) {
    console.error(`[wa:alert] instância ${instance.instanceName} sem usuário dono (userId=${instance.userId})`);
    return;
  }

  const recipients = new Map<string, string>(); // email -> nome
  recipients.set(owner.email, owner.name);
  for (const ou of orgOwners) recipients.set(ou.user.email, ou.user.name);

  const appUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "";
  const reconnectUrl = `${appUrl}/configuracoes`;
  const phoneLabel = instance.phoneNumber ? ` (${instance.phoneNumber})` : "";

  const html = `
    <p>O WhatsApp de <strong>${owner.name}</strong>${phoneLabel} desconectou do CRM.</p>
    <p>Enquanto estiver desconectado, mensagens não são enviadas nem recebidas pelo CRM pra esse número.</p>
    <p><a href="${reconnectUrl}">Reconectar agora</a> (Configurações → Perfil → WhatsApp).</p>
  `;

  await sendEmail({
    to: Array.from(recipients.keys()),
    subject: `⚠️ WhatsApp de ${owner.name} desconectou`,
    html,
  });

  console.log(`[wa:alert] e-mail de desconexão enviado para: ${Array.from(recipients.keys()).join(", ")}`);
}
