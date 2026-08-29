import type { TranscriptSegment } from "./types";
import { processFinalSegment } from "./pipeline";

/** `(textoConfirmado, fraseFinalCrua, idioma) → novo texto confirmado` — o
 * ponto de troca entre reconhecimento e interpretação (ver pipeline.ts).
 * Injetável: quem quiser uma interpretação diferente da prosa padrão (ex.:
 * o Registro Rápido, que precisa do texto CRU pra sua própria varredura de
 * rótulos "Rótulo: valor", nunca da prosa pontuada) passa a própria função
 * aqui em vez de usar o pipeline determinístico default. */
export type SegmentProcessor = (prevCommitted: string, rawFinalText: string, language: string) => string;

/**
 * Guarda o texto CONFIRMADO atual (uma string só, ver `TranscriptSegment`
 * pra por que não é "uma string por segmento") + um histórico leve de
 * QUANDO/O QUE foi dito, pra auditoria/reprocessamento futuro.
 *
 * SEM guarda de "mesmo texto do anterior = ignora": cogitado a princípio
 * (proteção contra WebSpeechEngine entregar o mesmo resultado 2x), mas
 * WebSpeechEngine já garante 1 `onFinal` por frase fechada (ver o próprio
 * arquivo) — a duplicação "João quer comprar João quer comprar" que o
 * pedido cita era um bug de reencadeamento incorreto, já corrigido ali, não
 * algo que uma guarda aqui precisasse resolver de novo. Uma guarda por
 * igualdade de texto causava um problema pior do que o que evitava: alguém
 * repetindo a MESMA frase de propósito (ex.: "cidade Campo Grande" dito 2x)
 * tinha a 2ª vez descartada em silêncio, sem nenhum sinal de que a fala não
 * "pegou" — pior ainda, um consumidor que recalcula o texto por fora (ver
 * handleDictated em quick-register-deal-form.tsx) divergia do texto
 * confirmado aqui dentro, já que só um dos dois lados aplicava a guarda.
 */
export class TranscriptEngine {
  private confirmedTextValue = "";
  private segments: TranscriptSegment[] = [];
  private interim = "";
  private nextId = 1;

  constructor(
    // Mutáveis (não readonly) — hooks React (ver lib/use-voice-transcription.ts)
    // resincronizam isto a cada render via setLanguage()/setProcessor(), pra
    // nunca ficar presos numa versão antiga se o prop passado mudar de
    // identidade, sem precisar de indireção via ref (refs lidas dentro de
    // uma closure criada durante o render são desencorajadas pelo próprio
    // React — ver react-hooks/refs).
    private language: string,
    private processSegment: SegmentProcessor = processFinalSegment,
    initialText = "",
  ) {
    if (initialText) this.setCommittedText(initialText);
  }

  setLanguage(language: string): void {
    this.language = language;
  }

  setProcessor(processSegment: SegmentProcessor): void {
    this.processSegment = processSegment;
  }

  get confirmedText(): string {
    return this.confirmedTextValue;
  }

  get interimText(): string {
    return this.interim;
  }

  /** Confirmado + provisório concatenado cru — o que a tela mostra em tempo real. */
  get displayText(): string {
    if (!this.interim) return this.confirmedTextValue;
    const needsSpace = this.confirmedTextValue && !/\s$/.test(this.confirmedTextValue);
    return `${this.confirmedTextValue}${needsSpace ? " " : ""}${this.interim}`;
  }

  setInterim(text: string): void {
    this.interim = text;
  }

  /** Aplica o pipeline determinístico (ver pipeline.ts) e atualiza o texto confirmado. Devolve `null` se o texto ficou vazio (nunca ignora por ser igual ao anterior — ver comentário da classe). */
  commitFinal(rawText: string, confidence: number | null, now: number = Date.now()): TranscriptSegment | null {
    const trimmed = rawText.trim();
    this.interim = "";
    if (!trimmed) return null;

    this.confirmedTextValue = this.processSegment(this.confirmedTextValue, trimmed, this.language);
    const segment: TranscriptSegment = {
      id: `seg-${this.nextId++}`,
      rawText: trimmed,
      isFinal: true,
      confidence,
      startTime: now,
      endTime: now,
    };
    this.segments.push(segment);
    return segment;
  }

  /** Edição manual (a pessoa digitando por cima do campo) — descarta o histórico de fala (não é mais fiel depois de uma edição manual arbitrária), sempre limpa o provisório. */
  setCommittedText(text: string): void {
    this.interim = "";
    this.confirmedTextValue = text;
    this.segments = [];
  }

  reset(): void {
    this.confirmedTextValue = "";
    this.segments = [];
    this.interim = "";
  }
}
