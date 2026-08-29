/**
 * Configuração central do subsistema de voz — único ponto de ajuste dos
 * números que hoje estariam espalhados por vários arquivos (padrão real do
 * projeto é constante local por arquivo — ver lib/automations/engine.ts,
 * voice-input-button.tsx — mas aqui a MAIORIA dos valores é consumida por
 * mais de um módulo do pipeline, então um objeto central evita threshold
 * divergente entre quem pontua e quem decide pergunta).
 */
export const VOICE_CONFIG = {
  defaultLanguage: "pt-BR",
  fallbackLanguage: "en-US",
  interimResults: true,
  maxAlternatives: 1,

  /** Backoff em ms pra cada tentativa de reconexão automática após a engine
   * cair de forma inesperada (nunca numa pausa comum entre frases — isso a
   * própria engine resolve sem acionar isto). Curto de propósito: uma queda
   * de rede real já vai bater no teto rápido e ir pra ERROR em vez de ficar
   * tentando por muito tempo sem avisar o usuário. */
  restartBackoffMs: [300, 900, 2700],
  maxAutoRestarts: 3,

  /** Some sozinho depois disso — mesmo valor que já existia no componente antigo. */
  errorAutoDismissMs: 4000,

  /** Score mínimo (ver question-detector.ts) pra fechar a frase com "?" em
   * vez de ".". Abaixo disso — inclusive score "ambíguo", ver o pedido —
   * nunca força interrogação: fecha com "." (nunca deixa a frase sem
   * nenhuma pontuação final, isso lê pior numa nota do que um ponto
   * conservador quando a confiança não é alta o bastante pra "?"). */
  questionThreshold: 6,

  /** Nível de áudio (0–1) que separa os 4 buckets de animação/VAD. */
  audioLevelBuckets: { low: 0.15, normal: 0.4, high: 0.7 },
} as const;
