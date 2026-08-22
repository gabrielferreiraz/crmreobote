/**
 * Sinal "algo mudou" pro Pipeline (Kanban/Lista) atualizar sozinho, sem
 * esperar F5 — publicado depois que um negócio é gravado no banco (webhook
 * do Meta Ads, criação manual, API pública, importação em massa, resposta
 * de campanha de WhatsApp), consumido pela rota SSE
 * (app/api/deals/live/route.ts). Mesmo mecanismo já usado (e provado em
 * produção) pro chat/lista de conversas de WhatsApp — ver
 * lib/whatsapp/live-events.ts, cujo comentário de topo explica em detalhe o
 * raciocínio; aqui é só o mesmo padrão aplicado a negócio.
 *
 * De propósito NÃO carrega o negócio em si — só avisa "teve negócio novo no
 * funil X" e quem está ouvindo refaz o mesmo fetch que já fazia (GET
 * /api/deals, GET /api/deals/stage-counts). Isso reaproveita 100% da lógica
 * de permissão/escopo (RLS + team scope, ver lib/team-scope.ts) que essas
 * rotas já tinham — o canal ao vivo só troca "quando" buscar de novo, nunca
 * decide sozinho "o quê" cada pessoa pode ver. Um Consultor com escopo
 * restrito nunca recebe o negócio de outro pelo canal — ele só recebe o
 * AVISO, e o refetch que ele mesmo dispara já aplica o escopo dele de
 * sempre.
 *
 * EventEmitter em memória, não Redis/pub-sub externo — mesma decisão (e
 * mesmo motivo) de lib/whatsapp/live-events.ts: o app roda num container só
 * (sem load balancer, ver Dockerfile), então todo cliente conectado via SSE
 * está sempre no MESMO processo que recebe o webhook/API. Se um dia isso
 * escalar horizontalmente, precisa virar Redis pub/sub — até lá, isso é
 * suficiente e não adiciona nenhuma peça de infra nova.
 */

import { EventEmitter } from "node:events";

export type DealsLiveEvent = { type: "deal-created"; pipelineId: string };

// Guardado em globalThis pelo mesmo motivo do client do Prisma em lib/prisma.ts
// (e do emitter de WhatsApp acima) — o Next.js pode empacotar este módulo mais
// de uma vez em contextos diferentes durante o dev, e cada cópia teria seu
// próprio EventEmitter isolado.
const globalForLiveEvents = globalThis as unknown as { dealsLiveEmitter?: EventEmitter };

const emitter = globalForLiveEvents.dealsLiveEmitter ?? new EventEmitter();
// Cada aba de Pipeline aberta é um listener — sem isso, o Node avisa
// "MaxListenersExceededWarning" a partir do 11º ouvinte simultâneo, um
// número normal de ter em produção.
emitter.setMaxListeners(0);

if (process.env.NODE_ENV !== "production") globalForLiveEvents.dealsLiveEmitter = emitter;

function channel(organizationId: string): string {
  return `deals:${organizationId}`;
}

/** Chamado depois de gravar o negócio no banco — nunca antes, senão quem está ouvindo busca dado que ainda não existe. */
export function publishDealsEvent(organizationId: string, event: DealsLiveEvent): void {
  emitter.emit(channel(organizationId), event);
}

/** Devolve a função de cancelamento — sempre chamar quando a conexão SSE fechar, senão o listener vaza pra sempre. */
export function subscribeDealsEvents(
  organizationId: string,
  listener: (event: DealsLiveEvent) => void,
): () => void {
  emitter.on(channel(organizationId), listener);
  return () => emitter.off(channel(organizationId), listener);
}
