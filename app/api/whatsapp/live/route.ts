import { requireSession } from "@/lib/require-session";
import { subscribeWhatsAppEvents, type WhatsAppLiveEvent } from "@/lib/whatsapp/live-events";

export const dynamic = "force-dynamic";

// Comentário SSE (linha começando com ":", ignorada pelo EventSource do
// navegador) só pra manter a conexão viva atrás de proxy reverso — sem
// tráfego nenhum por um tempo, alguns proxies derrubam a conexão HTTP por
// "ociosa" mesmo sendo keep-alive de propósito.
const HEARTBEAT_MS = 25_000;

/**
 * Empurra "algo mudou" pro chat/lista de conversas de WhatsApp em tempo real
 * (ver lib/whatsapp/live-events.ts) — substitui o polling de 4-5s como
 * mecanismo PRINCIPAL de atualização; o polling continua existindo só como
 * rede de segurança, bem mais espaçado, pro caso desta conexão cair (ex.:
 * proxy corporativo que bloqueia SSE) sem o cliente notar.
 */
export async function GET() {
  const { organizationId } = await requireSession();
  if (!organizationId) return new Response("Não autenticado", { status: 401 });

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: WhatsAppLiveEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Controller já fechado (cliente desconectou entre o evento surgir
          // e ser enfileirado) — o `cancel()` abaixo cuida da limpeza.
        }
      };

      unsubscribe = subscribeWhatsAppEvents(organizationId, send);

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          // idem — cancel() já deve estar a caminho.
        }
      }, HEARTBEAT_MS);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx (e proxies compatíveis) por padrão fazem buffer de respostas —
      // sem isso, os eventos só chegariam ao navegador em lotes atrasados,
      // exatamente o atraso que esta rota existe pra eliminar.
      "X-Accel-Buffering": "no",
    },
  });
}
