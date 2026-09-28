/**
 * Testes das decisões PURAS do guarda de WhatsApp das campanhas — o que decide
 * quando o motor pausa uma campanha e quando ela volta sozinha. Sem banco.
 * Rodar: npx tsx --test scripts/test-campaign-instance-guard.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { RISK_THRESHOLD, RISK_WINDOW_MS, isInstabilityRisk } from "@/lib/whatsapp/risk";
import { PAUSE_REASON, parsePauseReason } from "@/lib/campaigns/pause-reasons";
import {
  SUSPECT_MAX_AGE_MS,
  classifyInstance,
  decideResume,
  pauseReasonForOffline,
  type InstanceHealthRow,
} from "@/lib/campaigns/instance-readiness";

const NOW = new Date("2026-09-26T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function instance(overrides: Partial<InstanceHealthRow> = {}): InstanceHealthRow {
  return { status: "CONNECTED", pendingDisconnectSince: null, recentDisconnectCount: 0, riskWindowStartedAt: null, ...overrides };
}

/** Uma instância que caiu `count` vezes numa janela aberta há `windowAgeMs`. */
function unstable(count: number, windowAgeMs: number, overrides: Partial<InstanceHealthRow> = {}): InstanceHealthRow {
  return instance({ recentDisconnectCount: count, riskWindowStartedAt: new Date(NOW.getTime() - windowAgeMs), ...overrides });
}

test("constantes de risco: 3 quedas em 7 dias (mesma política do health-check)", () => {
  assert.equal(RISK_THRESHOLD, 3);
  assert.equal(RISK_WINDOW_MS, 7 * DAY);
});

test("classifyInstance: só CONNECTED sem suspeita está pronta", () => {
  assert.equal(classifyInstance(instance()), "ready");
  assert.equal(classifyInstance(instance({ status: "DISCONNECTED" })), "offline");
  assert.equal(classifyInstance(instance({ status: "CONNECTING" })), "offline");
});

test("classifyInstance: CONNECTED com suspeita do health-check segura o envio sem contar como queda", () => {
  assert.equal(classifyInstance(instance({ pendingDisconnectSince: new Date(NOW.getTime() - 30_000) }), NOW), "suspect");
});

test("classifyInstance: suspeita velha (health-check parou) é ignorada — não pode reter campanha em silêncio", () => {
  const justInside = new Date(NOW.getTime() - SUSPECT_MAX_AGE_MS + 1_000);
  const exactlyExpired = new Date(NOW.getTime() - SUSPECT_MAX_AGE_MS);
  assert.equal(classifyInstance(instance({ pendingDisconnectSince: justInside }), NOW), "suspect");
  assert.equal(classifyInstance(instance({ pendingDisconnectSince: exactlyExpired }), NOW), "ready");
  assert.equal(classifyInstance(instance({ pendingDisconnectSince: new Date(NOW.getTime() - 3 * 60 * 60 * 1000) }), NOW), "ready");
});

test("classifyInstance: sem a linha da instância = offline (não há por onde mandar)", () => {
  assert.equal(classifyInstance(null), "offline");
});

test("classifyInstance: DISCONNECTED é offline mesmo com pendingDisconnectSince preenchido", () => {
  assert.equal(classifyInstance(instance({ status: "DISCONNECTED", pendingDisconnectSince: NOW })), "offline");
});

test("isInstabilityRisk: precisa de 3+ quedas DENTRO da janela de 7 dias", () => {
  assert.equal(isInstabilityRisk(unstable(2, 1 * DAY), NOW), false);
  assert.equal(isInstabilityRisk(unstable(3, 1 * DAY), NOW), true);
  assert.equal(isInstabilityRisk(unstable(5, 6 * DAY + 23 * 60 * 60 * 1000), NOW), true);
});

test("isInstabilityRisk: janela vencida é histórico, não risco (mesmo com contagem alta)", () => {
  assert.equal(isInstabilityRisk(unstable(5, 7 * DAY), NOW), false); // exatamente 7 dias já venceu
  assert.equal(isInstabilityRisk(unstable(5, 30 * DAY), NOW), false);
});

test("isInstabilityRisk: contagem sem janela registrada não é risco", () => {
  assert.equal(isInstabilityRisk({ recentDisconnectCount: 5, riskWindowStartedAt: null }, NOW), false);
});

test("pauseReasonForOffline: queda comum é WHATSAPP_DISCONNECTED (retoma sozinha)", () => {
  assert.equal(pauseReasonForOffline(instance({ status: "DISCONNECTED" }), NOW), PAUSE_REASON.WHATSAPP_DISCONNECTED);
  assert.equal(pauseReasonForOffline(null, NOW), PAUSE_REASON.WHATSAPP_DISCONNECTED);
  assert.equal(pauseReasonForOffline(unstable(2, DAY, { status: "DISCONNECTED" }), NOW), PAUSE_REASON.WHATSAPP_DISCONNECTED);
});

test("pauseReasonForOffline: número no estado de risco pausa como INSTABILITY (só volta na mão)", () => {
  assert.equal(pauseReasonForOffline(unstable(3, DAY, { status: "DISCONNECTED" }), NOW), PAUSE_REASON.WHATSAPP_INSTABILITY);
});

test("decideResume: WhatsApp ainda fora do ar → segue pausada", () => {
  assert.equal(decideResume(instance({ status: "DISCONNECTED" }), NOW), "wait");
  assert.equal(decideResume(instance({ status: "CONNECTING" }), NOW), "wait");
  assert.equal(decideResume(null, NOW), "wait");
});

test("decideResume: voltou mas o health-check ainda desconfia → espera (e para de esperar se a suspeita ficou velha)", () => {
  assert.equal(decideResume(instance({ pendingDisconnectSince: NOW }), NOW), "wait");
  assert.equal(decideResume(instance({ pendingDisconnectSince: new Date(NOW.getTime() - SUSPECT_MAX_AGE_MS) }), NOW), "resume");
});

test("decideResume: voltou e está estável → retoma", () => {
  assert.equal(decideResume(instance(), NOW), "resume");
  assert.equal(decideResume(unstable(2, 2 * DAY), NOW), "resume");
});

test("decideResume: voltou mas o número está instável → NÃO retoma sozinha", () => {
  assert.equal(decideResume(unstable(3, 2 * DAY), NOW), "needs-human");
});

test("decideResume: contagem alta com janela vencida não bloqueia a retomada", () => {
  assert.equal(decideResume(unstable(5, 10 * DAY), NOW), "resume");
});

test("parsePauseReason: só os 3 motivos conhecidos; qualquer outra coisa vira pausa manual (null)", () => {
  assert.equal(parsePauseReason("WHATSAPP_DISCONNECTED"), PAUSE_REASON.WHATSAPP_DISCONNECTED);
  assert.equal(parsePauseReason("WHATSAPP_INSTABILITY"), PAUSE_REASON.WHATSAPP_INSTABILITY);
  assert.equal(parsePauseReason("FAILURES"), PAUSE_REASON.FAILURES);
  assert.equal(parsePauseReason("whatsapp_disconnected"), null);
  assert.equal(parsePauseReason("ALGO_NOVO"), null);
  assert.equal(parsePauseReason(""), null);
  assert.equal(parsePauseReason(null), null);
  assert.equal(parsePauseReason(undefined), null);
});
