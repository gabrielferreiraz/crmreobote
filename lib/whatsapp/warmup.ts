/**
 * Aquecimento gradual de volume pra número novo (ou "novo de novo", depois de
 * ficar muito tempo desconectado) — o próprio WhatsApp trata um número que
 * de repente manda centenas de mensagens sem histórico de uso normal como
 * sinal forte de automação. Rampa baseada no que ferramentas anti-ban do
 * ecossistema Baileys documentam publicamente (ex.: kobie3717/baileys-antiban):
 * volume baixo nos primeiros dias, crescendo exponencialmente, sem teto
 * (além do configurado pela própria organização) depois de uma semana.
 *
 * Só vale pra provider EVOLUTION (sessão WhatsApp Web/Baileys) — a API
 * oficial da Meta (META_CLOUD) tem seu próprio sistema de tier/qualidade
 * gerenciado pela própria Meta (ver quality_rating em lib/meta-whatsapp.ts),
 * não precisa desse aquecimento artificial.
 */

const WARMUP_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_DAILY_CAP = 20;
const GROWTH_FACTOR = 1.8;

/**
 * Retorna o teto de mensagens INICIAIS (não conta reenvio/follow-up, que é
 * baixo volume por natureza) permitido hoje só pelo aquecimento — `null`
 * significa "sem restrição adicional por aquecimento" (instância nunca
 * rastreada, ou já passou dos WARMUP_DAYS). Quem chama ainda aplica o teto
 * configurado na própria campanha por cima disso (o menor dos dois vale).
 */
export function warmupDailyCap(firstConnectedAt: Date | null): number | null {
  if (!firstConnectedAt) return null; // instância legada/não rastreada — nunca restringe por omissão

  const elapsedDays = Math.floor((Date.now() - firstConnectedAt.getTime()) / DAY_MS);
  if (elapsedDays >= WARMUP_DAYS) return null;

  return Math.floor(BASE_DAILY_CAP * GROWTH_FACTOR ** Math.max(0, elapsedDays));
}

/** 72h desconectado é tratado como "chip esfriou" — reinicia a rampa do zero quando reconectar. */
const COOLDOWN_RESET_MS = 72 * 60 * 60 * 1000;

export function shouldResetWarmup(disconnectedAt: Date | null): boolean {
  if (!disconnectedAt) return false;
  return Date.now() - disconnectedAt.getTime() >= COOLDOWN_RESET_MS;
}
