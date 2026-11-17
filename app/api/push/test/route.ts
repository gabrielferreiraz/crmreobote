import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { sendPushToUser } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function POST() {
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const clientPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey || !process.env.VAPID_PRIVATE_KEY || !clientPublicKey) {
    return NextResponse.json({ error: "O servidor não está configurado para enviar notificações push." }, { status: 503 });
  }
  if (publicKey !== clientPublicKey) {
    return NextResponse.json({ error: "As chaves push do navegador e do servidor não correspondem. Peça ao suporte para revisar a configuração." }, { status: 503 });
  }

  return runWithTenant(organizationId, async () => {
    try {
      const total = await prisma.pushSubscription.count({ where: { userId } });
      if (total === 0) {
        return NextResponse.json({ error: "Este navegador ainda não está registrado. Desative e ative as notificações para sincronizar." }, { status: 409 });
      }

      const delivery = await sendPushToUser(userId, {
        title: "Notificação de teste do CRM",
        body: "As notificações push estão chegando a este dispositivo.",
        url: "/configuracoes/perfil",
        tag: `crm-push-test-${Date.now()}`,
      });

      if (delivery.sent === 0) {
        return NextResponse.json({ error: "Nenhum dispositivo aceitou o envio. Desative e reative as notificações neste computador para renovar a inscrição e tente novamente." }, { status: 502 });
      }

      return NextResponse.json({ sent: delivery.sent, total: delivery.total });
    } catch (error) {
      console.error("[push-test] falha ao enviar teste", { userId, error });
      return NextResponse.json({ error: "Falha ao enviar o teste. Tente novamente ou peça ao suporte para verificar os logs." }, { status: 502 });
    }
  });
}
