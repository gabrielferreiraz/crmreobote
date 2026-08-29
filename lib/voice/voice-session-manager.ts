import type { SpeechEngine, VoiceError, VoiceSessionState, VoiceMetricsSnapshot } from "./types";
import { WebSpeechEngine } from "./web-speech-engine";
import { AudioMonitor } from "./audio-monitor";
import { VoiceMetrics } from "./metrics";
import { VOICE_CONFIG } from "./config";
import { processFinalSegmentWithDetail } from "./pipeline";
import { getLanguageProfile } from "./language-profile";

export type VoiceSessionSnapshot = {
  state: VoiceSessionState;
  error: VoiceError | null;
  isSpeaking: boolean;
  audioBars: number[];
  metrics: VoiceMetricsSnapshot;
};

export type VoiceSessionCallbacks = {
  /** Texto CRU reconhecido, sem processamento nenhum (ver types.ts — reconhecimento ≠ interpretação). */
  onInterim?: (text: string) => void;
  onFinal?: (text: string, confidence: number | null) => void;
  /** Dispara só quando a sessão INTEIRA acabou (parada pelo usuário, ou erro sem mais tentativa de recuperação) — nunca numa pausa comum. */
  onListeningChange?: (listening: boolean) => void;
};

/**
 * Dono de UMA sessão de ditado: SpeechEngine + AudioMonitor + FSM +
 * métricas + política de restart. A UI (voice-input-button.tsx) nunca fala
 * com SpeechEngine/AudioMonitor diretamente — só com isto, via
 * subscribe()/getSnapshot() (mesmo contrato de `useSyncExternalStore`).
 *
 * Reencadeamento de FRASE (pausa comum, silêncio prolongado) é resolvido
 * por dentro da própria WebSpeechEngine, invisível aqui. O que ESTE módulo
 * decide é bem mais raro: a engine caiu de vez por um erro recuperável
 * (ex.: rede instável) — tenta reconectar sozinho com backoff curto e teto
 * de tentativas (VOICE_CONFIG), nunca em loop infinito; esgotado o teto, ou
 * erro não-recuperável (permissão negada, sem microfone), vai pra ERROR de
 * vez e avisa quem está ouvindo.
 */
export class VoiceSessionManager {
  private readonly engine: SpeechEngine;
  private readonly audioMonitor = new AudioMonitor();
  private metrics = new VoiceMetrics();
  private state: VoiceSessionState = "IDLE";
  private error: VoiceError | null = null;
  private isSpeaking = false;
  private audioBars: number[] = [];
  private restartAttempts = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  // true só durante a JANELA de espera do backoff (ver handleEngineEnd) —
  // nesse intervalo `state` já voltou pra "STARTING" mas a engine em si
  // está parada de vez (nenhuma recognition em voo), então um stop() que
  // chegasse aqui achando que era a mesma STARTING de sempre chamaria
  // engine.stop() à toa (no-op silencioso) e travaria a sessão em
  // PROCESSING pra sempre, já que nenhum onEnd nunca mais viria.
  private awaitingRestart = false;
  private errorDismissTimer: ReturnType<typeof setTimeout> | null = null;
  private callbacks: VoiceSessionCallbacks = {};
  private readonly listeners = new Set<() => void>();
  // useSyncExternalStore (ver voice-input-button.tsx) exige que getSnapshot()
  // devolva a MESMA referência entre chamadas enquanto nada mudou — recalcular
  // um objeto novo a cada leitura faria o React achar que o estado mudou a
  // cada render e entrar num loop. Recalculado só dentro de emit(), nunca em
  // getSnapshot() em si.
  private cachedSnapshot: VoiceSessionSnapshot;
  // Buffer só de métrica — roda o pipeline determinístico por baixo dos
  // panos pra contar frase/pontuação/pergunta (ver metrics.ts), mesmo
  // quando quem está ouvindo (ex.: Registro Rápido) usa um `commit` PRÓPRIO
  // e nunca vê este texto — onFinal continua devolvendo o texto CRU pra
  // fora sempre, isto aqui nunca vaza pro consumidor.
  private metricsBuffer = "";
  // Mutável (não readonly) — ver setLanguage() abaixo.
  private language: string;

  constructor(
    language: string,
    private readonly barCount: number,
    engine: SpeechEngine = new WebSpeechEngine(),
  ) {
    this.language = language;
    this.engine = engine;
    this.cachedSnapshot = this.buildSnapshot();
  }

  get isSupported(): boolean {
    return this.engine.isSupported;
  }

  /** A engine de fato só lê `language` no PRÓXIMO `start()`/reconexão — trocar
   * no meio de uma sessão já ouvindo não interrompe nem reinicia nada
   * sozinho (ver voice-input-button.tsx, chamado num efeito quando o prop
   * `lang` muda). */
  setLanguage(language: string): void {
    this.language = language;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): VoiceSessionSnapshot {
    return this.cachedSnapshot;
  }

  private buildSnapshot(): VoiceSessionSnapshot {
    return {
      state: this.state,
      error: this.error,
      isSpeaking: this.isSpeaking,
      audioBars: this.audioBars,
      metrics: this.metrics.snapshot(),
    };
  }

  private emit(): void {
    this.cachedSnapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  start(callbacks: VoiceSessionCallbacks): void {
    // Trava contra clique/toque duplo — mesma proteção que já existia:
    // sem isso, dois cliques rápidos antes do 1º re-render criavam duas
    // sessões ouvindo o mesmo microfone ao mesmo tempo.
    if (this.state === "STARTING" || this.state === "LISTENING") return;
    if (!this.isSupported) return;

    this.callbacks = callbacks;
    this.error = null;
    this.restartAttempts = 0;
    this.metrics = new VoiceMetrics();
    this.metricsBuffer = "";
    this.clearRestartTimer();
    this.clearErrorDismissTimer();
    this.state = "STARTING";
    this.emit();

    this.beginEngineSession();

    this.audioMonitor.start(this.barCount, (sample) => {
      this.isSpeaking = sample.bucket !== "silence";
      this.audioBars = sample.bars;
      this.metrics.recordAudioLevel(this.isSpeaking);
      this.emit();
    });

    this.state = "LISTENING";
    this.callbacks.onListeningChange?.(true);
    this.emit();
  }

  private beginEngineSession(): void {
    // Resolve pelo MESMO LanguageProfile que o pipeline de texto usa (ver
    // pipeline.ts) — `speechLocale` pode um dia divergir do `locale`
    // "canônico" do perfil (ex.: um perfil "pt" genérico que reconhece
    // como "pt-BR" especificamente); passar `this.language` cru pra engine
    // ignoraria essa tradução.
    const speechLocale = getLanguageProfile(this.language).speechLocale;
    this.engine.start(
      { language: speechLocale, interimResults: VOICE_CONFIG.interimResults, maxAlternatives: VOICE_CONFIG.maxAlternatives },
      {
        onInterim: (text) => {
          this.metrics.recordInterim();
          this.callbacks.onInterim?.(text);
        },
        onFinal: (text, confidence) => {
          this.metrics.recordFinal(text, confidence);
          const detail = processFinalSegmentWithDetail(this.metricsBuffer, text, this.language);
          if (detail) {
            this.metricsBuffer = detail.text;
            this.metrics.recordPunctuation(detail.candidateType);
          }
          this.callbacks.onFinal?.(text, confidence);
        },
        onError: (error) => {
          this.error = error;
          this.metrics.recordError();
          this.emit();
        },
        onEnd: (reason) => this.handleEngineEnd(reason),
      },
    );
  }

  private handleEngineEnd(reason: "user" | "error"): void {
    if (reason === "error" && this.error?.recoverable && this.restartAttempts < VOICE_CONFIG.maxAutoRestarts) {
      const backoffMs = VOICE_CONFIG.restartBackoffMs[this.restartAttempts] ?? VOICE_CONFIG.restartBackoffMs.at(-1)!;
      this.restartAttempts += 1;
      this.metrics.recordRestart();
      this.state = "STARTING";
      this.awaitingRestart = true;
      this.emit();
      this.restartTimer = setTimeout(() => {
        this.awaitingRestart = false;
        this.error = null;
        this.beginEngineSession();
        this.state = "LISTENING";
        this.emit();
      }, backoffMs);
      return;
    }

    this.state = reason === "error" ? "ERROR" : "STOPPED";
    this.audioMonitor.stop();
    this.audioBars = Array(this.barCount).fill(0);
    this.callbacks.onListeningChange?.(false);
    this.emit();

    // Mesmo comportamento que já existia (ERROR_AUTO_DISMISS_MS): o balão
    // de erro não fica preso na tela pra sempre — some sozinho e volta pro
    // estado neutro, sem exigir um clique só pra "limpar" o aviso.
    if (this.state === "ERROR") {
      this.errorDismissTimer = setTimeout(() => {
        this.state = "IDLE";
        this.error = null;
        this.emit();
      }, VOICE_CONFIG.errorAutoDismissMs);
    }
  }

  /** Pedido do usuário — a engine ainda pode entregar um último resultado
   * pendente antes de fechar de vez (ver types.ts, estado PROCESSING). */
  stop(): void {
    if (this.state !== "LISTENING" && this.state !== "STARTING") return;
    this.clearRestartTimer();

    if (this.awaitingRestart) {
      // Não há nenhuma recognition em voo pra esperar — encerra direto,
      // sem passar por PROCESSING (ver comentário em `awaitingRestart`).
      this.awaitingRestart = false;
      this.state = "STOPPED";
      this.audioMonitor.stop();
      this.audioBars = Array(this.barCount).fill(0);
      this.callbacks.onListeningChange?.(false);
      this.emit();
      return;
    }

    this.state = "PROCESSING";
    this.emit();
    this.engine.stop();
  }

  /** Encerramento forçado (unmount) — não espera nada pendente. */
  destroy(): void {
    this.clearRestartTimer();
    this.clearErrorDismissTimer();
    this.awaitingRestart = false;
    this.engine.abort();
    this.audioMonitor.stop();
    this.state = "IDLE";
    this.listeners.clear();
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private clearErrorDismissTimer(): void {
    if (this.errorDismissTimer) clearTimeout(this.errorDismissTimer);
    this.errorDismissTimer = null;
  }
}
