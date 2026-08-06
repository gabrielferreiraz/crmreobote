/**
 * Sinal "algo mudou" pro chat/lista de conversas de WhatsApp atualizarem na
 * hora, sem esperar o próximo ciclo de polling — publicado pelo webhook (ver
 * lib/whatsapp/events.ts) assim que uma mensagem/status/presença é gravado
 * no banco, consumido pela rota SSE (app/api/whatsapp/live/route.ts).
 *
 * De propósito NÃO carrega o dado em si (mensagem, status, etc.) — só avisa
 * "teve mudança na thread X" e quem está ouvindo refaz o mesmo fetch que já
 * fazia no polling de sempre (GET /api/whatsapp/messages/[threadId] ou GET
 * /api/whatsapp/conversations). Isso reaproveita 100% da lógica de permissão/
 * escopo que essas rotas já tinham — o canal ao vivo só troca "quando" buscar
 * de novo, nunca decide sozinho "o quê" cada pessoa pode ver.
 *
 * EventEmitter em memória, não Redis/pub-sub externo — igual à decisão já
 * tomada pro rate limiter (ver lib/rate-limit.ts): o app roda num container
 * só (sem load balancer, ver Dockerfile), então todo cliente conectado via
 * SSE está sempre no MESMO processo que recebe o webhook. Se um dia isso
 * escalar horizontalmente, precisa virar Redis pub/sub — até lá, isso é
 * suficiente e não adiciona nenhuma peça de infra nova.
 */

import { EventEmitter } from "node:events";

export type WhatsAppLiveEvent =
  | { type: "message"; threadId: string }
  | { type: "status"; threadId: string }
  | { type: "presence"; threadId: string };

// Guardado em globalThis pelo mesmo motivo do client do Prisma em lib/prisma.ts:
// o Next.js pode empacotar este módulo mais de uma vez em contextos diferentes
// durante o dev, e cada cópia teria seu próprio EventEmitter isolado — o
// webhook publicaria num emitter que nenhuma rota SSE está ouvindo.
const globalForLiveEvents = globalThis as unknown as { waLiveEmitter?: EventEmitter };

const emitter = globalForLiveEvents.waLiveEmitter ?? new EventEmitter();
// Cada aba/conversa aberta é um listener — sem isso, o Node avisa
// "MaxListenersExceededWarning" no log a partir do 11º ouvinte simultâneo,
// um número normal de ter em produção.
emitter.setMaxListeners(0);

if (process.env.NODE_ENV !== "production") globalForLiveEvents.waLiveEmitter = emitter;

function channel(organizationId: string): string {
  return `wa:${organizationId}`;
}

/** Chamado pelos handlers de webhook depois de gravar no banco — nunca antes, senão quem está ouvindo busca dado que ainda não existe. */
export function publishWhatsAppEvent(organizationId: string, event: WhatsAppLiveEvent): void {
  emitter.emit(channel(organizationId), event);
}

/** Devolve a função de cancelamento — sempre chamar quando a conexão SSE fechar, senão o listener vaza pra sempre. */
export function subscribeWhatsAppEvents(
  organizationId: string,
  listener: (event: WhatsAppLiveEvent) => void,
): () => void {
  emitter.on(channel(organizationId), listener);
  return () => emitter.off(channel(organizationId), listener);
}
