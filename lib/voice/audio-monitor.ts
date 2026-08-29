import type { AudioLevelBucket, AudioLevelSample } from "./types";
import { VOICE_CONFIG } from "./config";

const FFT_SIZE = 64;

/**
 * Monitor de volume do microfone — mesma técnica já usada em
 * components/whatsapp-chat.tsx's `AudioForm` (gravação de áudio do
 * WhatsApp, não relacionada a ditado, não mexida aqui): `getUserMedia` +
 * `AnalyserNode` + `requestAnimationFrame` lendo o volume por faixa de
 * frequência. A SpeechRecognition em si não expõe volume nenhum, por isso
 * abre um SEGUNDO `getUserMedia` só pra isso, em paralelo à captura própria
 * do reconhecimento — os dois convivem sem conflito, cada um com seu
 * próprio MediaStream do mesmo microfone.
 *
 * Objetivo NÃO é gravar áudio (nada é persistido) — só nível/atividade de
 * fala pra UX (animação contextual do botão) e heurísticas simples
 * (speakingDuration/silenceDuration nas métricas). Não é um VAD (Voice
 * Activity Detection) sofisticado de propósito — 4 buckets por threshold de
 * volume já bastam pro objetivo.
 */
export class AudioMonitor {
  private audioCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private rafId: number | null = null;
  private onSample: ((sample: AudioLevelSample) => void) | null = null;
  // `getUserMedia` é assíncrono — se stop() for chamado ENQUANTO essa
  // promise ainda está pendente (clique rápido start→stop, ou unmount
  // durante o prompt de permissão do navegador), sem essa flag o `then`
  // ainda adotava stream/AudioContext novos depois que ninguém mais ia
  // chamar stop() de novo — microfone ficava aberto pra sempre (leak real,
  // não hipotético: já vi esse padrão de bug em outro lugar do app com
  // getUserMedia). Resetada no início de todo start() novo.
  private stopRequested = false;

  async start(barCount: number, onSample: (sample: AudioLevelSample) => void): Promise<void> {
    this.stopRequested = false;
    this.onSample = onSample;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this.stopRequested) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      source.connect(analyser);
      this.audioCtx = audioCtx;
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        // Uma amostra por barra (0–1, nunca px — isso é decisão da UI) +
        // média geral pra classificar o bucket (usada pra intensidade da
        // animação como um todo, não faixa a faixa).
        const bars = Array.from({ length: barCount }, (_, i) => data[Math.floor((i * data.length) / barCount)] / 255);
        const average = bars.reduce((sum, v) => sum + v, 0) / bars.length;
        this.onSample?.({ level: average, bucket: classify(average), bars });
        this.rafId = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // Sem acesso ao microfone pra visualização não impede o ditado em si
      // (a SpeechEngine tem sua própria captura) — só fica sem a reação de
      // áudio.
    }
  }

  stop(): void {
    this.stopRequested = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.onSample = null;
  }
}

function classify(level: number): AudioLevelBucket {
  const { low, normal, high } = VOICE_CONFIG.audioLevelBuckets;
  if (level < low) return "silence";
  if (level < normal) return "low";
  if (level < high) return "normal";
  return "high";
}
