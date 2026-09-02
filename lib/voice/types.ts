/**
 * Tipos centrais do subsistema de voz — único arquivo "types.ts" do
 * projeto de propósito: o resto do código (lib/automations/,
 * lib/whatsapp/) mantém tipo junto da lógica que o usa, mas aqui ~14
 * arquivos (engine, sessão, transcrição, pontuação, pergunta, vocabulário,
 * métricas, UI) precisam dos MESMOS tipos — duplicar ou criar import
 * circular entre eles seria pior que a exceção.
 *
 * Camadas (não misturar reconhecimento com interpretação — decisão
 * explícita do pedido): SpeechEngine só emite o que foi RECONHECIDO (texto
 * cru, sem pontuação/capitalização/vocabulário nenhum aplicado);
 * TranscriptSegment é a unidade que sai dali; tudo que vem DEPOIS
 * (Normalization/Vocabulary/Punctuation/Question) é processamento de
 * linguagem, nunca reconhecimento.
 */

// ─── Sessão ──────────────────────────────────────────────────────────────

/**
 * 6 estados, todos alcançáveis por um gatilho real da UI/engine hoje —
 * removidos de propósito da lista ilustrativa do pedido: SPEAKING (vira
 * `isSpeaking: boolean` derivado do AudioMonitor — falar ou não falar não
 * muda o que a sessão PODE fazer a seguir, só a UI), PAUSED (não existe
 * nenhum botão de pausar hoje) e STOPPING (destroy()/abort() — usado só no
 * unmount — encerra tudo de forma síncrona, sem nenhuma janela real em que
 * um estado "parando" fosse observável por alguém; ir direto pra IDLE é o
 * que de fato acontece). Declarar um estado que nada nunca alcança violaria
 * a própria regra "não crie estados sem necessidade".
 */
export type VoiceSessionState =
  | "IDLE" // nunca iniciado, ou já resetado
  | "STARTING" // start() chamado, aguardando a engine confirmar
  | "LISTENING" // ouvindo de verdade (pode estar em silêncio ou falando — ver isSpeaking)
  | "PROCESSING" // stop() pedido pelo usuário, aguardando o último resultado pendente da engine
  | "STOPPED" // sessão encerrada de propósito
  | "ERROR"; // engine falhou de vez (permissão negada, sem mic, restart esgotado)

export type VoiceErrorCode =
  | "not-allowed"
  | "no-microphone"
  | "network"
  | "language-not-supported"
  | "unsupported"
  | "unknown";

/** Erro compreensível pro usuário final — nunca o código cru da
 * SpeechRecognition ("network", "aborted"...) direto na tela. */
export type VoiceError = {
  code: VoiceErrorCode;
  /** Mensagem em pt-BR pronta pra mostrar na UI. */
  userMessage: string;
  /** Se true, a sessão pode tentar se recuperar sozinha (ver VoiceSessionManager); se false, precisa de ação do usuário (ex.: conceder permissão). */
  recoverable: boolean;
};

// ─── Transcrição ─────────────────────────────────────────────────────────

/**
 * Um item do histórico de fala CONFIRMADA (ver TranscriptEngine) — guarda
 * só o texto CRU (exatamente como a engine reconheceu, antes de qualquer
 * processamento), nunca o texto PROCESSADO acumulado. Isso é deliberado
 * pra escalar: o texto processado (normalizado/pontuado) de cada instante
 * é uma string do tamanho de TUDO que já foi dito até ali — guardar essa
 * string inteira em CADA segmento faria o histórico crescer O(n²) em vez
 * de O(n) numa sessão de ditado longa (n segmentos de tamanho médio m
 * viram n·m de texto cru total, mas 1+2+...+n = O(n²) se cada um também
 * guardasse o acumulado até aquele ponto). `TranscriptEngine.confirmedText`
 * guarda só o resultado ATUAL (uma string só, O(1) de espaço extra por
 * commit) — o histórico aqui serve pra auditoria de QUANDO/O QUE foi dito
 * (útil pra reprocessar com uma engine diferente no futuro), não pra saber
 * como o texto ficava em cada instante intermediário.
 */
export type TranscriptSegment = {
  id: string;
  /** Texto exatamente como a engine reconheceu, antes de qualquer processamento. */
  rawText: string;
  isFinal: true; // TranscriptEngine só guarda segmentos finais — o provisório nunca vira um TranscriptSegment (ver TranscriptEngine)
  confidence: number | null;
  startTime: number;
  endTime: number;
};

// ─── Speech Engine (abstração sobre o motor de reconhecimento) ───────────

export type SpeechEngineOptions = {
  language: string; // BCP-47 (ex.: "pt-BR")
  interimResults: boolean;
  maxAlternatives: number;
};

export type SpeechEngineEvents = {
  onInterim: (text: string) => void;
  /** confidence pode ser null — nem toda engine/navegador reporta um valor confiável. */
  onFinal: (text: string, confidence: number | null) => void;
  onError: (error: VoiceError) => void;
  /** Só dispara quando a sessão de fato encerrou (parada pelo usuário, ou erro
   * que a engine decidiu não tentar recuperar sozinha) — nunca numa pausa
   * comum entre frases, isso a engine resolve por dentro sem avisar ninguém. */
  onEnd: (reason: "user" | "error") => void;
};

/**
 * Interface pequena de propósito — só o necessário pra WebSpeechEngine hoje.
 * Ponto de extensão pra futuras engines (Vosk, nativo, cloud) sem tocar em
 * VoiceSessionManager/TranscriptEngine/pipeline — nenhuma delas é
 * implementada agora, só a interface fica pronta pra receber.
 */
export interface SpeechEngine {
  readonly isSupported: boolean;
  start(options: SpeechEngineOptions, events: SpeechEngineEvents): void;
  /** Pedido do usuário — a engine deve tentar fechar a frase em curso antes de emitir onEnd("user"). */
  stop(): void;
  /** Encerramento forçado (unmount) — não espera nada pendente. */
  abort(): void;
}

// ─── Áudio ───────────────────────────────────────────────────────────────

export type AudioLevelBucket = "silence" | "low" | "normal" | "high";

export type AudioLevelSample = {
  /** 0–1 normalizado, média geral (usado pra classificar o bucket). */
  level: number;
  bucket: AudioLevelBucket;
  /** Nível 0–1 por barra (N faixas de frequência) — a UI decide a altura em px de cada uma; o engine nunca sabe de pixel. */
  bars: number[];
};

// ─── Idioma ──────────────────────────────────────────────────────────────

export type SentenceConnector = {
  word: string;
  punctuation: "," | ";" | "—";
  /** Quanto esse conectivo pesa a favor de "aqui começa uma nova oração dentro da mesma frase" (ver sentence-boundary-detector.ts). */
  scoreBonus: number;
};

export type LanguageProfile = {
  locale: string;
  /** Repassado direto pra SpeechEngineOptions.language. */
  speechLocale: string;
  /** Palavras interrogativas — usadas por question-detector.ts com peso por posição, nunca por includes() cego. */
  questionWords: string[];
  /** "não sei", "sei lá"... — presença ANTES de uma palavra interrogativa na mesma oração derruba o score de pergunta (ver question-detector.ts). */
  indirectQuestionMarkers: string[];
  /** Modal/cortesia que costuma abrir uma pergunta falada em pt-BR ("pode", "poderia", "tem como"...). */
  questionOpeners: string[];
  /** Marcador de pergunta de confirmação ("tag question") — em português
   * falado, NENHUMA palavra interrogativa é necessária pra fazer uma
   * pergunta de sim/não; quem sinaliza isso é a ENTONAÇÃO, que texto não
   * carrega. Esses marcadores ("né", "combinado", "ou não"...) aparecem
   * quase sempre coladinhos no FINAL da fala — quando aparecem lá, é sinal
   * de sobra de que é pergunta, mesmo sem nenhum "quem/qual/quando". Sinal
   * independente da posição (ver question-detector.ts): não decai com
   * distância do início como questionWords, porque por definição vive perto
   * do FIM. */
  questionTagMarkers: string[];
  /** Verbo de confirmação/fechamento (pretérito perfeito, tipicamente) que,
   * aparecendo como a PRIMEIRA palavra da fala (sujeito omitido — "Fechou o
   * negócio?", "Confirmou a reunião?"), quase sempre marca pergunta de
   * sim/não em português falado: um relato ("ele fechou...") normalmente
   * mantém o sujeito explícito; começar direto pelo verbo sem sujeito é
   * majoritariamente pergunta ou eco de pergunta recebida. Dois níveis de
   * confiança (ver question-detector.ts):
   *  - Forte: verbo de ação de fechamento sem uso declarativo plausível sem
   *    sujeito ("Assinou o contrato?", "Pagou a fatura?") — decide sozinho.
   *  - Moderado: verbo-resultado que TAMBÉM abre frase declarativa legítima
   *    sem sujeito ("Rolou uma reunião ontem", "Deu certo a negociação") —
   *    só ajuda a cruzar o threshold combinado com outro sinal. */
  subjectlessQuestionVerbsStrong: string[];
  subjectlessQuestionVerbsModerate: string[];
  sentenceConnectors: SentenceConnector[];
  /** Marcador de discurso ("por exemplo", "ou seja", "na verdade"...) que
   * pede vírgula antes dele mesmo quando aparece DENTRO de um segmento já
   * reconhecido de uma vez (sem pausa nenhuma no meio) — sentenceConnectors
   * acima só cobre o caso de a PAUSA cair exatamente ali (segmento novo
   * começando com o conectivo); isto aqui cobre o resto: alguém fala tudo
   * de uma vez, "vou fazer por exemplo uma proposta menor", sem nenhuma
   * pausa antes de "por exemplo" — mesmo assim a vírgula é gramaticalmente
   * esperada ali. Ver mid-sentence-comma.ts. */
  midSentenceCommaMarkers: string[];
  /** Palavras que NUNCA terminam uma frase sozinhas nesse idioma (preposição,
   * artigo, conjunção subordinativa...) — usadas por
   * sentence-boundary-detector.ts pra reabrir um fechamento provisório
   * mesmo sem nenhum conectivo no segmento seguinte: se o texto confirmado
   * termina numa dessas palavras bem antes do ".", é sinal de que a pausa
   * foi só hesitação no MEIO da ideia, não o fim dela. Excluídos de
   * propósito pronomes/demonstrativos que PODEM terminar uma frase sozinhos
   * ("isso", "aquilo", "esse", "aquele"...) — incluir esses geraria falso
   * positivo emendando duas frases de fato separadas. */
  danglingEndings: string[];
};

// ─── Vocabulário ─────────────────────────────────────────────────────────

export type VocabularyTerm = {
  /** Forma preferida — o que aparece no texto final. */
  preferred: string;
  /** Outras formas conhecidas que devem virar `preferred` (fronteira de palavra, nunca substring cega). */
  aliases: string[];
  /** Impede outras heurísticas (ex.: capitalização de início de frase) de alterar este termo quando ele não estiver no início. */
  protectedFromCasing?: boolean;
};

// ─── Pontuação / Pergunta ────────────────────────────────────────────────

export type PunctuationCandidateType = "period" | "comma" | "question" | "none";

export type QuestionScore = {
  isQuestion: boolean;
  score: number;
  reason: string;
};

// ─── Métricas ────────────────────────────────────────────────────────────

export type VoiceMetricsSnapshot = {
  sessionDurationMs: number;
  speakingDurationMs: number;
  silenceDurationMs: number;
  firstInterimLatencyMs: number | null;
  firstFinalLatencyMs: number | null;
  averageConfidence: number | null;
  finalConfidence: number | null;
  restartCount: number;
  errorCount: number;
  wordCount: number;
  sentenceCount: number;
  punctuationCount: number;
  questionDetectionCount: number;
};
