/**
 * Validação de RMKT (ondas de reengajamento) + delay entre mensagens —
 * extraído daqui pra parar de existir em duas cópias quase idênticas
 * (app/api/contacts/bulk-send-leads/route.ts, único lugar que tinha isso
 * até agora, e app/api/deals/bulk-send-message/route.ts, que ganhou a
 * mesma capacidade pra dar paridade com quem já tem negócio — ver
 * lib/campaigns/engine.ts pro porquê disso agora funcionar pros dois).
 * Mensagens de erro idênticas às que já existiam em bulk-send-leads —
 * não é um comportamento novo, só o mesmo texto sem repetir o código.
 */

// Mesmos limites de lib/campaigns/build.ts — sem eles um valor absurdo
// desliga na prática a proteção anti-ban da engine de campanhas.
const MIN_DELAY_SEC = 10;
const MAX_DELAY_SEC = 3600;
const MIN_NO_REPLY_DAYS = 1;
const MAX_NO_REPLY_DAYS = 90;
const MAX_RMKT_WAVES = 10;

export type RmktWaveInput = { dayOffset: number; scriptId: string };

export type ValidateRmktAndDelayInput = {
  rmktEnabled?: boolean;
  rmktWaves?: RmktWaveInput[];
  noReplyDays?: number;
  delayMinSec?: number;
  delayMaxSec?: number;
  /** Cada chamador tem seu próprio padrão (bulk-send-leads: 80–1220s, mais
   * espaçado, pensado pra prospecção fria; bulk-send-message: 50–120s,
   * pensado pra quem já é negócio ativo) — só entra em jogo quando nem
   * delayMinSec nem delayMaxSec vêm no corpo da requisição. */
  defaultDelayMinSec: number;
  defaultDelayMaxSec: number;
};

export type ValidateRmktAndDelayResult =
  | {
      ok: true;
      resolvedNoReplyDays: number;
      waves: RmktWaveInput[];
      resolvedDelayMinSec: number;
      resolvedDelayMaxSec: number;
    }
  | { ok: false; error: string };

export function validateRmktAndDelay(input: ValidateRmktAndDelayInput): ValidateRmktAndDelayResult {
  const resolvedNoReplyDays = input.noReplyDays ?? 3;
  if (
    !Number.isInteger(resolvedNoReplyDays) ||
    resolvedNoReplyDays < MIN_NO_REPLY_DAYS ||
    resolvedNoReplyDays > MAX_NO_REPLY_DAYS
  ) {
    return {
      ok: false,
      error: `Prazo pra considerar "não respondeu" precisa estar entre ${MIN_NO_REPLY_DAYS} e ${MAX_NO_REPLY_DAYS} dias`,
    };
  }

  const waves = input.rmktEnabled ? (input.rmktWaves ?? []) : [];
  if (input.rmktEnabled) {
    if (waves.length === 0) return { ok: false, error: "Adicione ao menos uma onda de RMKT" };
    if (waves.length > MAX_RMKT_WAVES) {
      return { ok: false, error: `Máximo de ${MAX_RMKT_WAVES} ondas de RMKT` };
    }
    let previousDayOffset = 0;
    for (const wave of waves) {
      if (!Number.isInteger(wave.dayOffset) || wave.dayOffset <= previousDayOffset) {
        return {
          ok: false,
          error: "Os dias das ondas de RMKT precisam ser crescentes (cada onda depois da anterior)",
        };
      }
      if (wave.dayOffset >= resolvedNoReplyDays) {
        return {
          ok: false,
          error: `Cada onda precisa cair antes do prazo de "não respondeu" (${resolvedNoReplyDays} dias)`,
        };
      }
      if (!wave.scriptId) return { ok: false, error: "Selecione um script pra cada onda de RMKT" };
      previousDayOffset = wave.dayOffset;
    }
  }

  let resolvedDelayMinSec = input.defaultDelayMinSec;
  let resolvedDelayMaxSec = input.defaultDelayMaxSec;
  if (input.delayMinSec !== undefined || input.delayMaxSec !== undefined) {
    resolvedDelayMinSec = input.delayMinSec ?? input.defaultDelayMinSec;
    resolvedDelayMaxSec = input.delayMaxSec ?? input.defaultDelayMaxSec;
    if (
      !Number.isInteger(resolvedDelayMinSec) ||
      resolvedDelayMinSec < MIN_DELAY_SEC ||
      resolvedDelayMinSec > MAX_DELAY_SEC
    ) {
      return {
        ok: false,
        error: `Delay mínimo precisa estar entre ${MIN_DELAY_SEC} e ${MAX_DELAY_SEC} segundos`,
      };
    }
    if (
      !Number.isInteger(resolvedDelayMaxSec) ||
      resolvedDelayMaxSec < resolvedDelayMinSec ||
      resolvedDelayMaxSec > MAX_DELAY_SEC
    ) {
      return { ok: false, error: "Delay máximo precisa ser maior ou igual ao mínimo (e no máximo 1h)" };
    }
  }

  return { ok: true, resolvedNoReplyDays, waves, resolvedDelayMinSec, resolvedDelayMaxSec };
}
