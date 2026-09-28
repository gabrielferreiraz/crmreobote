/**
 * Previsão de QUANDO cada destinatário da fila de disparo deve sair — alimenta
 * "Próxima hora" e os horários da fila na tela da campanha. É uma PREVISÃO, não
 * uma promessa: o motor real (lib/campaigns/engine.ts) sorteia o intervalo a
 * cada tick do cron, falha de envio pula a vez, alguém pode pausar. Por isso
 * a tela sempre escreve "~14:07" e explica de onde veio o ritmo.
 *
 * Duas fontes pro RITMO (segundos entre um envio e o próximo):
 *  1. OBSERVADO — média dos intervalos reais dos últimos envios da própria
 *     campanha. É a melhor fonte: já embute tudo que a conta abaixo só
 *     aproxima (rodada do cron que demora porque processa várias campanhas
 *     em sequência, tempo de "digitando…", passos do script com espera).
 *  2. MODELO — só quando a campanha ainda não tem histórico. Reproduz a regra
 *     do motor (shouldSendNow): depois do delay mínimo, a CADA tick sorteia um
 *     limiar novo (gaussiana recortada em [min, max]) e envia se o tempo
 *     decorrido já o alcançou. Validado contra o histórico de produção: erra
 *     ≤5% nas campanhas de delay médio (ex.: 250-550s → 409s previsto vs 394s
 *     real) e subestima as de delay muito curto/largo — de onde vem a
 *     preferência pelo observado.
 *
 * Módulo puro (sem banco) de propósito: testável em scripts/test-campaign-queue.ts.
 */
import { BRAZIL_UTC_OFFSET_HOURS, brazilDateKey, brazilStartOfDay, getBrazilParts } from "@/lib/timezone";
import { nextAllowedSendWindow, type CampaignWindowConfig } from "@/lib/campaigns/estimate";

/** Quantos intervalos reais precisa ter pra confiar mais neles que no modelo. */
export const MIN_OBSERVED_GAPS = 8;
/** Intervalo maior que isso não é "ritmo", é pausa/virada de janela/teto do dia — fica de fora da média. */
const MAX_OBSERVED_GAP_SEC = 30 * 60;
/** Fração dos MAIORES intervalos descartada (pausas curtas, um "Enviar agora" fora de hora). */
const TRIM_FRACTION = 0.1;

/**
 * O cron de campanhas dispara ~1×/min (cron-job.org + o gatilho de reserva do
 * cron de automações; ver CronRun). Cada rodada processa TODAS as campanhas
 * em andamento em sequência, então o intervalo efetivo por campanha é de
 * ~1min — e ainda há o tempo do próprio envio ("digitando…", rede).
 */
const MODEL_TICK_SEC = 60;
const MODEL_OVERHEAD_SEC = 15;

/** CDF da normal padrão (aproximação de Abramowitz-Stegun, erro < 1e-7). */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/**
 * P(limiar sorteado ≤ decorrido) — mesma distribuição de gaussianDelaySample
 * no motor: gaussiana centrada no meio da faixa, desvio = 1/4 da largura
 * (±2 desvios cobre a faixa), recortada em [min, max].
 */
function thresholdCdf(elapsedSec: number, minSec: number, maxSec: number): number {
  if (elapsedSec < minSec) return 0;
  if (elapsedSec >= maxSec) return 1;
  const mean = (minSec + maxSec) / 2;
  const sd = (maxSec - minSec) / 4;
  return normalCdf((elapsedSec - mean) / sd);
}

/**
 * Espera média (s) entre dois envios pela regra do motor. `processingSec` é o
 * tempo que a rodada fica ocupada mandando os passos do script (soma das
 * esperas entre passos) — o cron só olha o próximo envio depois disso.
 */
export function modelIntervalSec(input: {
  minSec: number;
  maxSec: number;
  processingSec?: number;
  tickSec?: number;
  overheadSec?: number;
}): number {
  const { minSec, maxSec, processingSec = 0, tickSec = MODEL_TICK_SEC, overheadSec = MODEL_OVERHEAD_SEC } = input;
  let t = overheadSec + processingSec + tickSec / 2; // 1º tick que enxerga o envio anterior já terminado
  let survive = 1;
  let expected = 0;
  for (let i = 0; i < 5000 && survive > 1e-6; i++, t += tickSec) {
    const p = thresholdCdf(t, minSec, maxSec);
    expected += t * survive * p;
    survive *= 1 - p;
  }
  return Math.max(minSec, expected + survive * t);
}

/**
 * Ritmo real: média dos intervalos entre os últimos envios, do mais novo pro
 * mais velho (`sentAtDesc`). Descarta intervalo ≥ 30min (pausa, fim de janela,
 * teto do dia) e o décimo maior. null = histórico curto demais pra confiar.
 */
export function observedIntervalSec(sentAtDesc: Date[]): { intervalSec: number; samples: number } | null {
  const gaps: number[] = [];
  for (let i = 0; i < sentAtDesc.length - 1; i++) {
    const gap = (sentAtDesc[i].getTime() - sentAtDesc[i + 1].getTime()) / 1000;
    if (gap > 0 && gap < MAX_OBSERVED_GAP_SEC) gaps.push(gap);
  }
  if (gaps.length < MIN_OBSERVED_GAPS) return null;
  gaps.sort((a, b) => a - b);
  const kept = gaps.slice(0, gaps.length - Math.floor(gaps.length * TRIM_FRACTION));
  const mean = kept.reduce((sum, g) => sum + g, 0) / kept.length;
  return { intervalSec: mean, samples: gaps.length };
}

export type QueuePace = {
  intervalSec: number;
  /** De onde veio o número: "observed" = ritmo real dos últimos envios; "model" = cálculo pela configuração da campanha. */
  basis: "observed" | "model";
  /** Quantos intervalos reais sustentam "observed" (0 no modelo). */
  samples: number;
};

export function resolvePace(input: {
  minSec: number;
  maxSec: number;
  processingSec?: number;
  recentSentAtDesc: Date[];
}): QueuePace {
  const observed = observedIntervalSec(input.recentSentAtDesc);
  if (observed) return { intervalSec: observed.intervalSec, basis: "observed", samples: observed.samples };
  return {
    intervalSec: modelIntervalSec({ minSec: input.minSec, maxSec: input.maxSec, processingSec: input.processingSec }),
    basis: "model",
    samples: 0,
  };
}

/**
 * Tempo médio (s) que uma rodada gasta com os passos de UM script — a soma das
 * esperas ENTRE passos (o motor dorme delayAfterSec depois de cada passo,
 * menos o último), ponderada pelo peso de cada variante sorteável. Lê o
 * snapshot Campaign.messageTemplates ([{ steps: [{ text, delayAfterSec }], weight }]).
 */
export function expectedScriptProcessingSec(messageTemplates: unknown): number {
  if (!Array.isArray(messageTemplates) || messageTemplates.length === 0) return 0;
  let weighted = 0;
  let totalWeight = 0;
  for (const variant of messageTemplates as { steps?: unknown; weight?: unknown }[]) {
    const steps = Array.isArray(variant?.steps) ? (variant.steps as { delayAfterSec?: unknown }[]) : [];
    const waits = steps.slice(0, -1).reduce((sum, s) => sum + (typeof s?.delayAfterSec === "number" ? Math.max(0, s.delayAfterSec) : 0), 0);
    const weight = typeof variant?.weight === "number" && variant.weight > 0 ? variant.weight : 1;
    weighted += waits * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weighted / totalWeight : 0;
}

export type QueueSlotInput = {
  now: Date;
  /** Quantas posições da fila calcular (a 1ª, a 2ª, …, a N-ésima). */
  count: number;
  intervalSec: number;
  /** Último envio/reenvio da campanha (o motor conta o delay a partir dele — ver shouldSendNow). */
  lastEventAt: Date | null;
  schedule: CampaignWindowConfig;
  /** Menor entre o teto diário da campanha e o de aquecimento do número; null = sem teto. */
  dailyLimit: number | null;
  /** Quantos já saíram HOJE (calendário de Brasília). */
  sentToday: number;
};

/**
 * Horário previsto de cada posição da fila: o ritmo (`intervalSec`) aplicado
 * em sequência, empurrado pra dentro da janela de horário/dias permitida
 * (fora dela o motor não manda nada) e respeitando o teto diário (bateu o
 * teto, recomeça no próximo dia permitido). A i-ésima posição recebe SEMPRE o
 * i-ésimo horário, não importa quem esteja nela — por isso reordenar a fila
 * só troca quem ocupa cada horário. Lista vazia quando a campanha não tem
 * como mandar (nenhum dia permitido, janela inválida, teto 0).
 */
export function estimateQueueSlots(input: QueueSlotInput): Date[] {
  const { now, count, intervalSec, lastEventAt, schedule, dailyLimit, sentToday } = input;
  if (count <= 0 || intervalSec <= 0) return [];
  if (schedule.allowedWeekdays.length === 0 || schedule.windowEndHour <= schedule.windowStartHour) return [];
  if (dailyLimit !== null && dailyLimit <= 0) return [];

  const stepMs = intervalSec * 1000;
  const nowMs = now.getTime();

  // Fim da janela do dia de `ms` (meia-noite de Brasília é 04:00 UTC — ver lib/timezone.ts).
  const windowEndOf = (ms: number) => {
    const p = getBrazilParts(new Date(ms));
    return Date.UTC(p.year, p.month, p.day, schedule.windowEndHour + BRAZIL_UTC_OFFSET_HOURS, 0, 0);
  };
  const dayOf = (ms: number) => brazilDateKey(new Date(ms));

  // O 1º envio sai no próximo tick, sem esperar delay, se já passou o tempo desde o último.
  let cursor = lastEventAt ? Math.max(nowMs, lastEventAt.getTime() + stepMs) : nowMs;
  cursor = nextAllowedSendWindow(schedule, new Date(cursor)).getTime();
  let windowEnd = windowEndOf(cursor);
  let dayKey = dayOf(cursor);
  let usedToday = dayKey === dayOf(nowMs) ? sentToday : 0;

  const slots: Date[] = [];
  const maxIterations = count * 2 + 400; // trava de segurança contra laço infinito
  for (let iteration = 0; slots.length < count && iteration < maxIterations; iteration++) {
    if (dailyLimit !== null && usedToday >= dailyLimit) {
      // Teto do dia batido: recomeça na próxima janela permitida depois da meia-noite de Brasília.
      const nextMidnight = brazilStartOfDay(new Date(cursor)).getTime() + 24 * 60 * 60 * 1000;
      cursor = nextAllowedSendWindow(schedule, new Date(nextMidnight)).getTime();
      windowEnd = windowEndOf(cursor);
      dayKey = dayOf(cursor);
      usedToday = 0;
      continue;
    }

    slots.push(new Date(cursor));
    usedToday += 1;
    cursor += stepMs;

    if (cursor >= windowEnd) {
      cursor = nextAllowedSendWindow(schedule, new Date(cursor)).getTime();
      windowEnd = windowEndOf(cursor);
      const nextDay = dayOf(cursor);
      if (nextDay !== dayKey) {
        dayKey = nextDay;
        usedToday = 0;
      }
    }
  }
  return slots;
}

/** Quantas posições têm horário previsto dentro da próxima hora (`slots` em ordem crescente). */
export function countWithinNextHour(slots: Date[], now: Date): number {
  const limit = now.getTime() + 60 * 60 * 1000;
  let n = 0;
  for (const s of slots) {
    if (s.getTime() > limit) break;
    n += 1;
  }
  return n;
}
