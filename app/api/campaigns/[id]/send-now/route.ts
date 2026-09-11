import { NextResponse } from "next/server";
import { requireRole } from "@/lib/require-role";
import { sendCampaignRecipientNow, sendNextRmktWaveNow } from "@/lib/campaigns/engine";
import { rateLimitOrResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const REASON_MESSAGES: Record<string, string> = {
  "not-running": "A campanha precisa estar rodando pra enviar agora.",
  "outside-schedule": "Fora da janela de dias/horário configurada — nada foi enviado.",
  "daily-cap-reached": "Teto diário já atingido — nada foi enviado.",
  "no-pending": "Não há ninguém pendente pra enviar agora.",
};

// "no-pending" pro alvo wave merece uma mensagem própria — "ninguém
// pendente" soa como a campanha inteira parada, quando pode só ser que
// ninguém tem onda vencida agora (tem gente esperando o prazo, só ainda
// não chegou).
const WAVE_NO_PENDING_MESSAGE = "Não há ninguém com onda de RMKT vencida agora — a próxima ainda não chegou no prazo.";

/**
 * Força um envio imediatamente, pulando só o throttle de delay (ver
 * sendCampaignRecipientNow/sendNextRmktWaveNow). Body opcional
 * `{ target: "wave" }` — pedido explícito: botão dedicado "Enviar onda de
 * RMKT agora", que pula direto pra onda em vez de seguir a ordem de
 * prioridade normal (inicial → reenvio único → onda) do botão genérico.
 * Sem `target` (ou qualquer outro valor), comportamento de sempre.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const rateLimited = rateLimitOrResponse(`campaign-send-now:${access.organizationId}`, 20, 60_000);
  if (rateLimited) return rateLimited;

  const body = await req.json().catch(() => ({}));
  const onlyWave = (body as { target?: string }).target === "wave";

  const result = onlyWave
    ? await sendNextRmktWaveNow(access.organizationId, id)
    : await sendCampaignRecipientNow(access.organizationId, id);

  if (!result.ok) {
    const message = onlyWave && result.reason === "no-pending" ? WAVE_NO_PENDING_MESSAGE : (REASON_MESSAGES[result.reason] ?? "Não foi possível enviar agora");
    return NextResponse.json({ error: message }, { status: 400 });
  }
  return NextResponse.json(result);
}
