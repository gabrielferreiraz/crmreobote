import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveConnectedInstance } from "@/lib/whatsapp/send";

export const dynamic = "force-dynamic";

/**
 * Provider da instância de WhatsApp CONECTADA da pessoa logada (Evolution
 * ou Meta Cloud — resolveConnectedInstance prioriza Meta se as duas
 * existirem conectadas, mesmo critério usado no envio de verdade). Usado só
 * pra decidir se um disparo em massa (BulkSendMessageDialog/
 * BulkSendConversationsDialog/SendLeadsDialog) precisa de uma confirmação
 * extra antes de mandar: número conectado via QR Code (Evolution) tem risco
 * real de banimento num disparo grande; número oficial da Meta não.
 */
export async function GET() {
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const instance = await resolveConnectedInstance(organizationId, userId);
    return NextResponse.json({ connected: !!instance, provider: instance?.provider ?? null });
  });
}
