import { requireSession } from "@/lib/require-session";
import { subscribeDealsEvents, type DealsLiveEvent } from "@/lib/deals/live-events";

export const dynamic = "force-dynamic";

// Comentário SSE (linha começando com ":", ignorada pelo EventSource do
// navegador) só pra manter a conexão viva atrás de proxy reverso — sem
// tráfego nenhum por um tempo, alguns proxies derrubam a conexão HTTP por
// "ociosa" mesmo sendo keep-alive de propósito. Mesmo valor de
// app/api/whatsapp/live/route.ts.
const HEARTBEAT_MS = 25_000;

/**
 * Empurra "negócio novo no funil X" pro Pipeline em tempo real (ver
 * lib/deals/live-events.ts) — cópia do mecanismo já usado pro WhatsApp (ver
 * app/api/whatsapp/live/route.ts), mesma estrutura. Sem polling de rede de
 * segurança aqui (diferente do WhatsApp): o Kanban/Lista já refazem a
 * própria busca sozinhos toda vez que o usuário troca filtro/página, então
 * uma conexão perdida só significa "não vê o negócio novo até a próxima
 * ação manual" — bem menos crítico que uma mensagem de WhatsApp perdida.
 */
export async function GET() {
  const { organizationId } = await requireSession();
  if (!organizationId) return new Response("Não autenticado", { status: 401 });

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: DealsLiveEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Controller já fechado (cliente desconectou entre o evento surgir
          // e ser enfileirado) — o `cancel()` abaixo cuida da limpeza.
        }
      };

      unsubscribe = subscribeDealsEvents(organizationId, send);

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
