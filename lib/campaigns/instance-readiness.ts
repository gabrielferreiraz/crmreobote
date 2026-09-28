/**
 * Decisões PURAS (sem banco) do guarda de WhatsApp das campanhas — o que uma
 * linha de WhatsAppInstance diz sobre poder mandar agora, qual motivo gravar ao
 * pausar e quando dá pra retomar sozinho. Separadas de instance-guard.ts pra
 * serem testadas sem banco (scripts/test-campaign-instance-guard.ts).
 */

import { isInstabilityRisk } from "@/lib/whatsapp/risk";
import { PAUSE_REASON, type PauseReason } from "@/lib/campaigns/pause-reasons";
import type { $Enums } from "@/app/generated/prisma/client";

export type InstanceHealthRow = {
  status: $Enums.WhatsAppInstanceStatus;
  pendingDisconnectSince: Date | null;
  recentDisconnectCount: number;
  riskWindowStartedAt: Date | null;
};

/**
 * ready   — conectado e sem suspeita: pode mandar.
 * offline — o CRM sabe que caiu (status != CONNECTED): pausa a campanha.
 * suspect — o health-check viu o provedor reportando problema mas ainda não
 *           confirmou a queda (confirma na rodada seguinte, 1-2min). Segura o
 *           envio neste tick SEM pausar: se foi só um soluço ninguém percebe;
 *           se confirmar, vira "offline" e aí pausa.
 */
export type InstanceReadiness = "ready" | "offline" | "suspect";

/**
 * Suspeita do health-check mais velha que isso é ignorada. Ele resolve a
 * suspeita em 1-2min (some se o provedor voltou, ou vira queda confirmada); se
 * uma ficou pra trás, é o próprio health-check que parou — e isso não pode
 * reter campanha em silêncio pra sempre (o motor só segura o envio, sem pausar
 * nem avisar nada na tela).
 */
export const SUSPECT_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * `null` (linha da instância não achada) conta como offline: Campaign.instanceId
 * é FK sem cascade, então não deveria acontecer, mas sem a linha não há por onde mandar.
 */
export function classifyInstance(
  instance: Pick<InstanceHealthRow, "status" | "pendingDisconnectSince"> | null,
  now: Date = new Date(),
): InstanceReadiness {
  if (!instance || instance.status !== "CONNECTED") return "offline";
  if (instance.pendingDisconnectSince && now.getTime() - instance.pendingDisconnectSince.getTime() < SUSPECT_MAX_AGE_MS) return "suspect";
  return "ready";
}

/**
 * Motivo gravado ao pausar por queda. Número já no estado de risco (3+ quedas
 * em 7 dias) pausa como INSTABILITY — a política antiga do health-check, que
 * exige uma pessoa olhar antes de voltar a disparar por um número suspeito.
 */
export function pauseReasonForOffline(instance: InstanceHealthRow | null, now: Date): PauseReason {
  return instance && isInstabilityRisk(instance, now) ? PAUSE_REASON.WHATSAPP_INSTABILITY : PAUSE_REASON.WHATSAPP_DISCONNECTED;
}

/**
 * wait        — o WhatsApp ainda não voltou (ou voltou mas sob suspeita): segue pausada.
 * needs-human — voltou, mas o número está no estado de risco: não retoma sozinha.
 * resume      — voltou e está estável: retoma.
 */
export type ResumeDecision = "resume" | "wait" | "needs-human";

export function decideResume(instance: InstanceHealthRow | null, now: Date): ResumeDecision {
  if (!instance || classifyInstance(instance, now) !== "ready") return "wait";
  return isInstabilityRisk(instance, now) ? "needs-human" : "resume";
}
