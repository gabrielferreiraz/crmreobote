import { NextResponse } from "next/server";
import { requireRole } from "@/lib/require-role";
import { sendCampaignRecipientNow } from "@/lib/campaigns/engine";
import { rateLimitOrResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const REASON_MESSAGES: Record<string, string> = {
  "not-running": "A campanha precisa estar rodando pra enviar agora.",
  "outside-schedule": "Fora da janela de dias/horário configurada — nada foi enviado.",
  "daily-cap-reached": "Teto diário já atingido — nada foi enviado.",
  "no-pending": "Não há ninguém pendente pra enviar agora.",
};

/** Força o próximo envio (inicial ou de reenvio) imediatamente, pulando só o throttle de delay — ver sendCampaignRecipientNow. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const rateLimited = rateLimitOrResponse(`campaign-send-now:${access.organizationId}`, 20, 60_000);
  if (rateLimited) return rateLimited;

  const result = await sendCampaignRecipientNow(access.organizationId, id);
  if (!result.ok) {
    return NextResponse.json({ error: REASON_MESSAGES[result.reason] ?? "Não foi possível enviar agora" }, { status: 400 });
  }
  return NextResponse.json(result);
}
