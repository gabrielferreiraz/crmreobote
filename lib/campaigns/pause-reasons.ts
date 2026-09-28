/**
 * Por que uma campanha está PAUSED sem ninguém ter clicado em "Pausar"
 * (Campaign.pausedReason no schema). Arquivo folha — sem imports — porque é
 * usado pelo motor, pelo health-check, pelas rotas e pelas telas.
 *
 * null (nenhum motivo) = pausa MANUAL: nunca volta sozinha.
 */
export const PAUSE_REASON = {
  /** O WhatsApp caiu: o motor retoma SOZINHO quando ele reconectar (lib/campaigns/instance-guard.ts). */
  WHATSAPP_DISCONNECTED: "WHATSAPP_DISCONNECTED",
  /** 3+ quedas em 7 dias — risco de banimento (lib/whatsapp/health-check.ts): só volta com alguém retomando na mão. */
  WHATSAPP_INSTABILITY: "WHATSAPP_INSTABILITY",
  /** 5 falhas de envio seguidas (pauseIfFailing, lib/campaigns/engine.ts): só volta com alguém retomando na mão. */
  FAILURES: "FAILURES",
} as const;

export type PauseReason = (typeof PAUSE_REASON)[keyof typeof PAUSE_REASON];

/**
 * Valor cru do banco → motivo conhecido. A coluna é texto livre (acrescentar um
 * motivo não exige migration), então um valor que este código não conhece vira
 * null: tratado como pausa manual — o lado seguro, porque nunca retoma sozinho.
 */
export function parsePauseReason(value: string | null | undefined): PauseReason | null {
  return value === PAUSE_REASON.WHATSAPP_DISCONNECTED || value === PAUSE_REASON.WHATSAPP_INSTABILITY || value === PAUSE_REASON.FAILURES
    ? value
    : null;
}
