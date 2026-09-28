/**
 * Testes do núcleo da fila de disparo (lib/campaigns/queue-order.ts e
 * queue-estimate.ts) — funções puras, sem banco:
 *
 *   npx tsx --test scripts/test-campaign-queue.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareQueueOrder, reassignWindowPositions } from "@/lib/campaigns/queue-order";
import {
  MIN_OBSERVED_GAPS,
  countWithinNextHour,
  estimateQueueSlots,
  expectedScriptProcessingSec,
  modelIntervalSec,
  observedIntervalSec,
  resolvePace,
} from "@/lib/campaigns/queue-estimate";
import { getBrazilParts } from "@/lib/timezone";

/** Instante no horário de Brasília (Campo Grande, UTC-4). */
const brt = (y: number, m: number, d: number, h: number, mi = 0) => new Date(Date.UTC(y, m - 1, d, h + 4, mi));
/** "seg 10:00" legível pra mensagem de erro. */
const label = (d: Date) => {
  const p = getBrazilParts(d);
  return `${["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][p.weekday]} ${String(p.day).padStart(2, "0")}/${String(p.month + 1).padStart(2, "0")} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};
const labels = (ds: Date[]) => ds.map(label);

const WEEKDAYS = { allowedWeekdays: [1, 2, 3, 4, 5], windowStartHour: 9, windowEndHour: 18 };

// ─── ordenação ────────────────────────────────────────────────────────

test("compareQueueOrder: posição primeiro, null por último, depois createdAt e id", () => {
  const t0 = new Date("2026-09-01T12:00:00Z");
  const t1 = new Date("2026-09-01T12:00:01Z");
  const rows = [
    { id: "d", queuePosition: null, createdAt: t0 },
    { id: "c", queuePosition: 5, createdAt: t1 },
    { id: "b", queuePosition: -2, createdAt: t1 },
    { id: "a", queuePosition: null, createdAt: t0 },
    { id: "e", queuePosition: null, createdAt: t1 },
  ];
  const sorted = [...rows].sort(compareQueueOrder).map((r) => r.id);
  assert.deepEqual(sorted, ["b", "c", "a", "d", "e"]); // -2, 5, depois os null por createdAt e id (a < d, e por último)
});

// ─── reordenar uma janela ─────────────────────────────────────────────

test("reassignWindowPositions: troca de lugar e devolve só o que mudou", () => {
  const current = [
    { id: "a", position: 10 },
    { id: "b", position: 20 },
    { id: "c", position: 30 },
  ];
  const { updates, ignored } = reassignWindowPositions(current, ["c", "a", "b"]);
  assert.deepEqual(ignored, []);
  assert.deepEqual(
    Object.fromEntries(updates.map((u) => [u.id, u.position])),
    { c: 10, a: 20, b: 30 },
  );
});

test("reassignWindowPositions: quem está fora da janela não é tocado (e buracos de posição são preservados)", () => {
  // fila real: a(5) b(7) c(30) d(31); a tela só mostrou a e c
  const current = [
    { id: "a", position: 5 },
    { id: "c", position: 30 },
  ];
  const { updates } = reassignWindowPositions(current, ["c", "a"]);
  assert.deepEqual(
    Object.fromEntries(updates.map((u) => [u.id, u.position])),
    { c: 5, a: 30 }, // b(7) e d(31) nem entram na conta
  );
});

test("reassignWindowPositions: ordem igual = nenhuma atualização", () => {
  const current = [
    { id: "a", position: 1 },
    { id: "b", position: 2 },
  ];
  assert.deepEqual(reassignWindowPositions(current, ["a", "b"]).updates, []);
});

test("reassignWindowPositions: id que já saiu da fila é ignorado, repetido vale a 1ª vez", () => {
  const current = [
    { id: "a", position: 1 },
    { id: "b", position: 2 },
    { id: "c", position: 3 },
  ];
  const { updates, ignored } = reassignWindowPositions(current, ["c", "enviado-no-meio-tempo", "c", "a", "b"]);
  assert.deepEqual(ignored, ["enviado-no-meio-tempo"]);
  assert.deepEqual(
    Object.fromEntries(updates.map((u) => [u.id, u.position])),
    { c: 1, a: 2, b: 3 },
  );
});

test("reassignWindowPositions: posições negativas (mover pro topo) entram na conta", () => {
  const current = [
    { id: "x", position: -3 },
    { id: "a", position: 1 },
    { id: "b", position: 2 },
  ];
  const { updates } = reassignWindowPositions(current, ["b", "x", "a"]);
  assert.deepEqual(
    Object.fromEntries(updates.map((u) => [u.id, u.position])),
    { b: -3, x: 1, a: 2 },
  );
});

// ─── ritmo ────────────────────────────────────────────────────────────

test("modelIntervalSec: delay fixo espera o 1º tick depois do mínimo", () => {
  // 1º candidato em 15s (overhead) + 30s (meio tick) = 45s; ticks de 60s: 45, 105, ... 285 (<300), 345 (>=300)
  assert.equal(modelIntervalSec({ minSec: 300, maxSec: 300 }), 345);
});

test("modelIntervalSec: bate com o intervalo real de campanhas de produção (delay médio)", () => {
  // "Empresarios Ribas" 300-500s, script ~35s: real 414s; "Campanha Live segunda" 250-550s: real 394s
  const a = modelIntervalSec({ minSec: 300, maxSec: 500, processingSec: 35 });
  const b = modelIntervalSec({ minSec: 250, maxSec: 550, processingSec: 15 });
  assert.ok(a > 395 && a < 465, `300-500 previu ${a.toFixed(0)}s`);
  assert.ok(b > 380 && b < 440, `250-550 previu ${b.toFixed(0)}s`);
});

test("modelIntervalSec: nunca abaixo do mínimo e cresce com o máximo", () => {
  const short = modelIntervalSec({ minSec: 60, maxSec: 120 });
  const long = modelIntervalSec({ minSec: 60, maxSec: 600 });
  assert.ok(short >= 60);
  assert.ok(long > short);
});

test("observedIntervalSec: precisa de histórico mínimo", () => {
  const base = brt(2026, 9, 28, 12).getTime();
  const few = Array.from({ length: MIN_OBSERVED_GAPS }, (_, i) => new Date(base - i * 60_000)); // 8 datas = 7 intervalos
  assert.equal(observedIntervalSec(few), null);
  const enough = Array.from({ length: MIN_OBSERVED_GAPS + 1 }, (_, i) => new Date(base - i * 60_000));
  const r = observedIntervalSec(enough);
  assert.ok(r);
  assert.equal(Math.round(r.intervalSec), 60);
  assert.equal(r.samples, MIN_OBSERVED_GAPS);
});

test("observedIntervalSec: ignora pausa longa e descarta o décimo maior", () => {
  const base = brt(2026, 9, 28, 12).getTime();
  // 20 envios a cada 100s, mais um intervalo de 2h no meio (virada de janela) — não pode entrar na média
  const times: number[] = [];
  let t = base;
  for (let i = 0; i < 20; i++) {
    times.push(t);
    t -= i === 10 ? 2 * 3600_000 : 100_000;
  }
  const r = observedIntervalSec(times.map((ms) => new Date(ms)));
  assert.ok(r);
  assert.equal(Math.round(r.intervalSec), 100);

  // 19 intervalos: 18 de 60s e 1 de 900s — o décimo maior (o de 900s) é descartado
  const spiky: number[] = [];
  let u = base;
  for (let i = 0; i < 20; i++) {
    spiky.push(u);
    u -= i === 5 ? 900_000 : 60_000;
  }
  const s = observedIntervalSec(spiky.map((ms) => new Date(ms)));
  assert.ok(s);
  assert.equal(Math.round(s.intervalSec), 60);
});

test("resolvePace: usa o observado quando há histórico, senão o modelo", () => {
  const base = brt(2026, 9, 28, 12).getTime();
  const history = Array.from({ length: 12 }, (_, i) => new Date(base - i * 420_000)); // 7min
  const observed = resolvePace({ minSec: 30, maxSec: 90, recentSentAtDesc: history });
  assert.equal(observed.basis, "observed");
  assert.equal(Math.round(observed.intervalSec), 420);

  const model = resolvePace({ minSec: 30, maxSec: 90, recentSentAtDesc: [] });
  assert.equal(model.basis, "model");
  assert.equal(model.samples, 0);
  assert.ok(model.intervalSec > 30);
});

test("expectedScriptProcessingSec: soma as esperas ENTRE passos, ponderada pelo peso", () => {
  const one = [{ steps: [{ delayAfterSec: 20 }, { delayAfterSec: 40 }, { delayAfterSec: 99 }], weight: 1 }];
  assert.equal(expectedScriptProcessingSec(one), 60); // o último passo não espera
  const two = [
    { steps: [{ delayAfterSec: 20 }, { delayAfterSec: 40 }, { delayAfterSec: 0 }], weight: 1 },
    { steps: [{ delayAfterSec: 0 }], weight: 3 },
  ];
  assert.equal(expectedScriptProcessingSec(two), 15); // (60*1 + 0*3) / 4
  assert.equal(expectedScriptProcessingSec(null), 0);
  assert.equal(expectedScriptProcessingSec([]), 0);
});

// ─── horários da fila ─────────────────────────────────────────────────

test("estimateQueueSlots: dentro da janela, um a cada intervalo; passou das 18h vai pro dia seguinte às 9h", () => {
  const now = brt(2026, 9, 28, 10, 0); // segunda 10:00
  const slots = estimateQueueSlots({ now, count: 50, intervalSec: 600, lastEventAt: null, schedule: WEEKDAYS, dailyLimit: null, sentToday: 0 });
  assert.equal(label(slots[0]), "seg 28/09 10:00");
  assert.equal(label(slots[1]), "seg 28/09 10:10");
  assert.equal(label(slots[47]), "seg 28/09 17:50");
  assert.equal(label(slots[48]), "ter 29/09 09:00"); // 18:00 já é fora da janela
  assert.equal(label(slots[49]), "ter 29/09 09:10");
});

test("estimateQueueSlots: sexta no fim da janela pula o fim de semana", () => {
  const now = brt(2026, 10, 2, 17, 50); // sexta 17:50
  const slots = estimateQueueSlots({ now, count: 3, intervalSec: 600, lastEventAt: null, schedule: WEEKDAYS, dailyLimit: null, sentToday: 0 });
  assert.deepEqual(labels(slots), ["sex 02/10 17:50", "seg 05/10 09:00", "seg 05/10 09:10"]);
});

test("estimateQueueSlots: fora da janela começa na abertura seguinte", () => {
  const early = estimateQueueSlots({ now: brt(2026, 9, 28, 6, 0), count: 1, intervalSec: 600, lastEventAt: null, schedule: WEEKDAYS, dailyLimit: null, sentToday: 0 });
  assert.equal(label(early[0]), "seg 28/09 09:00");
  const night = estimateQueueSlots({ now: brt(2026, 9, 28, 21, 0), count: 1, intervalSec: 600, lastEventAt: null, schedule: WEEKDAYS, dailyLimit: null, sentToday: 0 });
  assert.equal(label(night[0]), "ter 29/09 09:00");
  const saturday = estimateQueueSlots({ now: brt(2026, 9, 26, 11, 0), count: 1, intervalSec: 600, lastEventAt: null, schedule: WEEKDAYS, dailyLimit: null, sentToday: 0 });
  assert.equal(label(saturday[0]), "seg 28/09 09:00");
});

test("estimateQueueSlots: teto diário — bateu, recomeça no próximo dia permitido", () => {
  const now = brt(2026, 9, 28, 10, 0);
  const slots = estimateQueueSlots({ now, count: 6, intervalSec: 600, lastEventAt: null, schedule: WEEKDAYS, dailyLimit: 3, sentToday: 1 });
  assert.deepEqual(labels(slots), [
    "seg 28/09 10:00",
    "seg 28/09 10:10", // 2 restantes hoje (teto 3, já saiu 1)
    "ter 29/09 09:00",
    "ter 29/09 09:10",
    "ter 29/09 09:20",
    "qua 30/09 09:00",
  ]);
});

test("estimateQueueSlots: teto já batido hoje empurra tudo pro próximo dia", () => {
  const now = brt(2026, 9, 28, 10, 0);
  const slots = estimateQueueSlots({ now, count: 2, intervalSec: 600, lastEventAt: null, schedule: WEEKDAYS, dailyLimit: 25, sentToday: 25 });
  assert.deepEqual(labels(slots), ["ter 29/09 09:00", "ter 29/09 09:10"]);
});

test("estimateQueueSlots: conta o intervalo a partir do último envio", () => {
  const now = brt(2026, 9, 28, 10, 0);
  const lastEventAt = new Date(now.getTime() - 2 * 60_000); // mandou há 2 min
  const slots = estimateQueueSlots({ now, count: 2, intervalSec: 600, lastEventAt, schedule: WEEKDAYS, dailyLimit: null, sentToday: 3 });
  assert.equal(label(slots[0]), "seg 28/09 10:08"); // último + 10min
  assert.equal(label(slots[1]), "seg 28/09 10:18");
  // último envio já faz tempo: o próximo sai agora
  const overdue = estimateQueueSlots({ now, count: 1, intervalSec: 600, lastEventAt: new Date(now.getTime() - 3600_000), schedule: WEEKDAYS, dailyLimit: null, sentToday: 3 });
  assert.equal(label(overdue[0]), "seg 28/09 10:00");
});

test("estimateQueueSlots: campanha sem como enviar devolve lista vazia", () => {
  const base = { now: brt(2026, 9, 28, 10), count: 5, intervalSec: 600, lastEventAt: null, dailyLimit: null, sentToday: 0 };
  assert.deepEqual(estimateQueueSlots({ ...base, schedule: { ...WEEKDAYS, allowedWeekdays: [] } }), []);
  assert.deepEqual(estimateQueueSlots({ ...base, schedule: { ...WEEKDAYS, windowEndHour: 9 } }), []);
  assert.deepEqual(estimateQueueSlots({ ...base, schedule: WEEKDAYS, dailyLimit: 0 }), []);
  assert.deepEqual(estimateQueueSlots({ ...base, schedule: WEEKDAYS, intervalSec: 0 }), []);
  assert.deepEqual(estimateQueueSlots({ ...base, schedule: WEEKDAYS, count: 0 }), []);
});

test("estimateQueueSlots: uma fila grande termina rápido e sempre em ordem crescente", () => {
  const started = Date.now();
  const slots = estimateQueueSlots({ now: brt(2026, 9, 28, 10), count: 5000, intervalSec: 400, lastEventAt: null, schedule: WEEKDAYS, dailyLimit: 25, sentToday: 0 });
  assert.equal(slots.length, 5000);
  for (let i = 1; i < slots.length; i++) assert.ok(slots[i].getTime() > slots[i - 1].getTime(), `posição ${i} fora de ordem`);
  // teto 25/dia, só dias úteis: 5000 envios levam ~200 dias úteis
  assert.ok(slots[4999].getTime() - slots[0].getTime() > 190 * 86_400_000);
  assert.ok(Date.now() - started < 3000, "estimar 5.000 posições não pode demorar");
});

test("countWithinNextHour", () => {
  const now = brt(2026, 9, 28, 10, 0);
  const slots = [0, 10, 20, 59, 60, 61, 120].map((m) => new Date(now.getTime() + m * 60_000));
  assert.equal(countWithinNextHour(slots, now), 5); // até 60 min inclusive
  assert.equal(countWithinNextHour([], now), 0);
});
