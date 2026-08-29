import type { SpeechEngine, SpeechEngineEvents, SpeechEngineOptions, VoiceError } from "./types";
import { isSpeechRecognitionSupported } from "./speech-engine";

/**
 * Única implementação de SpeechEngine hoje — encapsula TUDO que toca
 * `window.SpeechRecognition`/`webkitSpeechRecognition` (movido de
 * components/voice-input-button.tsx, que antes falava com o navegador
 * direto). Quem usa esta classe (VoiceSessionManager) NUNCA vê o
 * reencadeamento de frase-a-frase por dentro — só um `onEnd` de verdade,
 * quando a sessão realmente acabou.
 *
 * Motivo do reencadeamento (bug conhecido do Chrome): `continuous: true`
 * nativo para sozinho depois de alguns segundos. Solução: `continuous =
 * false` + reabrir uma instância nova sempre que uma frase fecha (por pausa
 * OU por "no-speech"), sem nunca notificar quem está ouvindo — pra fora,
 * parece um reconhecimento contínuo de verdade.
 */
export class WebSpeechEngine implements SpeechEngine {
  private recognition: SpeechRecognition | null = null;
  private options: SpeechEngineOptions | null = null;
  private events: SpeechEngineEvents | null = null;
  private stoppedByUser = true;
  /** Setado dentro de onerror, lido (e limpo) dentro de onend logo em
   * seguida — distingue "a sessão parou porque a pessoa clicou" de "parou
   * por causa de um erro real", pro VoiceSessionManager saber se vale a
   * pena tentar reconectar sozinho (ver política de restart lá). */
  private endReason: "user" | "error" = "user";

  get isSupported(): boolean {
    return isSpeechRecognitionSupported();
  }

  start(options: SpeechEngineOptions, events: SpeechEngineEvents): void {
    if (!this.isSupported) return;
    this.options = options;
    this.events = events;
    this.stoppedByUser = false;
    this.startRecognitionInstance();
  }

  stop(): void {
    this.stoppedByUser = true;
    this.recognition?.stop();
  }

  abort(): void {
    this.stoppedByUser = true;
    this.recognition?.abort();
  }

  /** Cria e inicia uma instância nova — o navegador não deixa reiniciar uma
   * já finalizada, por isso tanto `start()` quanto o reencadeamento
   * automático (dentro de `onend`) passam por aqui. */
  private startRecognitionInstance(): void {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor || !this.options || !this.events) return;

    const recognition = new Ctor();
    recognition.lang = this.options.language;
    recognition.continuous = false;
    recognition.interimResults = this.options.interimResults;
    recognition.maxAlternatives = this.options.maxAlternatives;

    recognition.onresult = (event) => {
      const lastIndex = event.results.length - 1;
      const lastResult = event.results[lastIndex];
      const transcript = Array.from({ length: event.results.length })
        .map((_, i) => event.results[i][0].transcript)
        .join(" ")
        .trim();
      if (!transcript) return;
      if (lastResult.isFinal) {
        const confidence = typeof lastResult[0].confidence === "number" ? lastResult[0].confidence : null;
        this.events?.onFinal(transcript, confidence);
      } else {
        this.events?.onInterim(transcript);
      }
    };

    recognition.onerror = (event) => {
      // "no-speech"/"aborted" são silêncio comum (a pessoa não falou nada
      // ainda, ou parou por conta própria) — nunca interrompem uma sessão
      // contínua, a pessoa pode só estar pensando no próximo trecho.
      if (event.error === "no-speech" || event.error === "aborted") return;
      this.stoppedByUser = true; // erro real encerra a sessão de vez, não reencadeia
      this.endReason = "error";
      this.events?.onError(mapSpeechError(event.error));
    };

    recognition.onend = () => {
      this.recognition = null;
      if (!this.stoppedByUser) {
        // Reencadeia sozinho — fenômeno interno do navegador (pausa comum
        // OU silêncio prolongado), nunca visível pra quem está ouvindo.
        this.startRecognitionInstance();
        return;
      }
      const reason = this.endReason;
      this.endReason = "user"; // reseta pra próxima sessão (start() também reseta stoppedByUser)
      this.events?.onEnd(reason);
    };

    this.recognition = recognition;
    recognition.start();
  }
}

const ERROR_MESSAGES: Record<string, VoiceError> = {
  "not-allowed": { code: "not-allowed", userMessage: "Permissão de microfone negada", recoverable: false },
  "service-not-allowed": { code: "not-allowed", userMessage: "Permissão de microfone negada", recoverable: false },
  "audio-capture": { code: "no-microphone", userMessage: "Nenhum microfone encontrado", recoverable: false },
  // O reconhecimento do Chrome/Edge processa o áudio no servidor deles, não
  // localmente — sem internet (comum pra vendedor em campo), o erro real é
  // conexão, não "não entendi o que você falou".
  network: { code: "network", userMessage: "Sem conexão com a internet", recoverable: true },
  // VOICE_CONFIG.defaultLanguage (pt-BR) é suportado por todo navegador com
  // Web Speech — isto só dispararia se o idioma da sessão fosse trocado pra
  // algo que o motor do navegador não reconhece (ver VoiceSessionManager.
  // setLanguage). Não-recuperável: tentar de novo com o MESMO idioma não vai
  // funcionar melhor da próxima vez.
  "language-not-supported": { code: "language-not-supported", userMessage: "Idioma não suportado para ditado por voz", recoverable: false },
};

/** Mapeia o código cru da SpeechRecognition pra um erro compreensível —
 * função pura, testável sem precisar de uma instância real de
 * reconhecimento (ver plano de verificação). */
export function mapSpeechError(rawCode: string): VoiceError {
  return (
    ERROR_MESSAGES[rawCode] ?? {
      code: "unknown",
      userMessage: "Não consegui entender — tente de novo",
      recoverable: true,
    }
  );
}
