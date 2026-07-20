import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { importHistoryMessages } from "@/lib/whatsapp/events";
import { rateLimitOrResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Puxa manualmente o histórico já sincronizado pelo Evolution pra essa
 * instância — existe pra quando o gatilho automático (evento MESSAGES_SET do
 * webhook, ver lib/whatsapp/events.ts) não rodou ou não trouxe nada (o
 * WhatsApp decide quanto histórico manda no pareamento, nem sempre manda
 * algo na hora certa, e o gatilho automático só reage a esse evento — não
 * tem como disparar de novo sozinho depois). Idempotente: mensagem já
 * importada é ignorada (dedup por externalId em saveIncomingMessage).
 */
export async function POST() {
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const rateLimited = rateLimitOrResponse(`import-history:${organizationId}`, 3, 10 * 60_000);
  if (rateLimited) return rateLimited;

  return runWithTenant(organizationId, async () => {
    // Importação de histórico só existe no Evolution — a API oficial da Meta
    // não tem endpoint equivalente (ver WhatsAppInstance.provider).
    const instance = await prisma.whatsAppInstance.findUnique({
      where: { organizationId_userId_provider: { organizationId, userId, provider: "EVOLUTION" } },
    });
    if (!instance) return NextResponse.json({ error: "Nenhum WhatsApp conectado" }, { status: 404 });
    if (instance.status !== "CONNECTED") {
      return NextResponse.json({ error: "Conecte o WhatsApp antes de importar o histórico" }, { status: 400 });
    }

    const result = await importHistoryMessages(instance);

    if (result.imported > 0 && !instance.historySyncedAt) {
      await prisma.whatsAppInstance.update({ where: { id: instance.id }, data: { historySyncedAt: new Date() } });
    }

    return NextResponse.json(result);
  });
}
