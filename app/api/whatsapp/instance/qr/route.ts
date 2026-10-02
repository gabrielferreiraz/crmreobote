import { NextResponse } from "next/server";
import { getQrCode } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const QR_TIMEOUT_MS = 5_000;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET() {
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  return runWithTenant(organizationId, async () => {
    const instance = await prisma.whatsAppInstance.findUnique({
      where: { organizationId_userId_provider: { organizationId, userId, provider: "EVOLUTION" } },
    });

    if (!instance) {
      return NextResponse.json(
        { error: "Nenhuma conexão em preparação" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    if (instance.status === "CONNECTED") {
      return NextResponse.json({ connected: true }, { headers: NO_STORE_HEADERS });
    }

    try {
      const qr = await getQrCode(instance.instanceName, QR_TIMEOUT_MS);
      if (qr.base64 || qr.pairingCode) {
        if (instance.status !== "CONNECTING") {
          await prisma.whatsAppInstance.update({ where: { id: instance.id }, data: { status: "CONNECTING" } });
        }
        return NextResponse.json(
          { qrCode: qr.base64 ?? null, pairingCode: qr.pairingCode ?? null, pending: false },
          { headers: NO_STORE_HEADERS },
        );
      }
    } catch {
      // Enquanto o provisionamento assíncrono está rodando, 404 e timeout são
      // estados esperados. A próxima consulta tenta de novo sem assustar o usuário.
    }

    if (instance.status === "CONNECTING") {
      return NextResponse.json({ pending: true }, { status: 202, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json(
      { error: "Não foi possível preparar o QR Code. Clique em Conectar para tentar novamente." },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  });
}
