import { NextResponse } from "next/server";
import { getQrCode } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const HEADERS = { "Cache-Control": "no-store" };

export async function GET() {
  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403, headers: HEADERS });

  return runWithTenant(access.organizationId, async () => {
    const instance = await prisma.whatsAppInstance.findFirst({
      where: { organizationId: access.organizationId, kind: "CENTRAL", provider: "EVOLUTION" },
    });
    if (!instance) return NextResponse.json({ error: "Central não configurada" }, { status: 404, headers: HEADERS });
    if (instance.status === "CONNECTED") {
      return NextResponse.json({ connected: true, phoneNumber: instance.phoneNumber }, { headers: HEADERS });
    }
    try {
      const qr = await getQrCode(instance.instanceName, 5_000);
      if (qr.base64 || qr.pairingCode) {
        return NextResponse.json(
          { qrCode: qr.base64 ?? null, pairingCode: qr.pairingCode ?? null, pending: false },
          { headers: HEADERS },
        );
      }
    } catch {
      // Provisionamento assíncrono ainda em andamento.
    }
    return NextResponse.json({ pending: true }, { status: 202, headers: HEADERS });
  });
}
