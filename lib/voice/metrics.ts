import type { VoiceMetricsSnapshot } from "./types";

/**
 * Métricas de UMA sessão de ditado — só números/durações, NUNCA o texto em
 * si (privacidade: transcrição de CRM é dado potencialmente sensível, não
 * pode acabar em log/console). Não é enviado a lugar nenhum hoje (o projeto
 * não tem pipeline de telemetria pra isso) — fica disponível via
 * `VoiceSessionManager.getSnapshot().metrics` pra uso futuro (debug, ou uma
 * tela de estatísticas, se algum dia fizer sentido).
 */
export class VoiceMetrics {
  private readonly sessionStart: number;
  private speakingMs = 0;
  private silenceMs = 0;
  private lastSampleAt: number | null = null;
  private firstInterimAt: number | null = null;
  private firstFinalAt: number | null = null;
  private confidenceSum = 0;
  private confidenceCount = 0;
  private lastConfidence: number | null = null;
  private restarts = 0;
  private errors = 0;
  private words = 0;
  private sentences = 0;
  private punctuationInsertions = 0;
  private questionsDetected = 0;

  constructor(now: number = Date.now()) {
    this.sessionStart = now;
  }

  recordInterim(now: number = Date.now()): void {
    if (this.firstInterimAt === null) this.firstInterimAt = now;
  }

  recordFinal(text: string, confidence: number | null, now: number = Date.now()): void {
    if (this.firstFinalAt === null) this.firstFinalAt = now;
    this.words += text.trim() ? text.trim().split(/\s+/).length : 0;
    if (confidence !== null) {
      this.confidenceSum += confidence;
      this.confidenceCount += 1;
      this.lastConfidence = confidence;
    }
  }

  recordPunctuation(type: "period" | "comma" | "question" | "none"): void {
    if (type === "none") return;
    this.punctuationInsertions += 1;
    if (type === "period" || type === "question") this.sentences += 1;
    if (type === "question") this.questionsDetected += 1;
  }

  recordRestart(): void {
    this.restarts += 1;
  }

  recordError(): void {
    this.errors += 1;
  }

  /** Amostra de nível de áudio (0–1) — acumula em falando/silêncio pelo tempo desde a última amostra. */
  recordAudioLevel(isSpeaking: boolean, now: number = Date.now()): void {
    if (this.lastSampleAt !== null) {
      const delta = now - this.lastSampleAt;
      if (isSpeaking) this.speakingMs += delta;
      else this.silenceMs += delta;
    }
    this.lastSampleAt = now;
  }

  snapshot(now: number = Date.now()): VoiceMetricsSnapshot {
    return {
      sessionDurationMs: now - this.sessionStart,
      speakingDurationMs: this.speakingMs,
      silenceDurationMs: this.silenceMs,
      firstInterimLatencyMs: this.firstInterimAt !== null ? this.firstInterimAt - this.sessionStart : null,
      firstFinalLatencyMs: this.firstFinalAt !== null ? this.firstFinalAt - this.sessionStart : null,
      averageConfidence: this.confidenceCount > 0 ? this.confidenceSum / this.confidenceCount : null,
      finalConfidence: this.lastConfidence,
      restartCount: this.restarts,
      errorCount: this.errors,
      wordCount: this.words,
      sentenceCount: this.sentences,
      punctuationCount: this.punctuationInsertions,
      questionDetectionCount: this.questionsDetected,
    };
  }
}
