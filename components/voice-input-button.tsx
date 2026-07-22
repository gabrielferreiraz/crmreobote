"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";

const WAVEFORM_BARS = 5;
const ERROR_AUTO_DISMISS_MS = 4000;

/**
 * Junta um trecho novo ditado com o que já existia no campo — capitaliza a
 * primeira letra do trecho novo e garante um ponto final antes de emendar.
 * Sem isso, duas frases ditadas em momentos diferentes (ex.: nota de negócio
 * complementada depois) viram uma corrida só sem pontuação nem maiúscula —
 * o Web Speech API nunca devolve isso sozinho, sempre em minúsculo e sem
 * pontuação final. Usado pelos 3 lugares que consomem VoiceInputButton em
 * vez de cada um reimplementar a mesma concatenação.
 */
export function appendDictatedText(prev: string, text: string): string {
  const trimmedNew = text.trim();
  if (!trimmedNew) return prev;
  const capitalized = trimmedNew.charAt(0).toUpperCase() + trimmedNew.slice(1);
  const trimmedPrev = prev.trim();
  if (!trimmedPrev) return capitalized;
  const needsPunctuation = !/[.!?…]$/.test(trimmedPrev);
  return `${trimmedPrev}${needsPunctuation ? "." : ""} ${capitalized}`;
}

/**
 * Ditado por voz via Web Speech API — nativa do navegador (Chrome/Edge/
 * Safari), sem custo e sem chave de API, mas não é padronizada: só existe
 * prefixada (`webkitSpeechRecognition`) em alguns navegadores e não existe
 * no Firefox (ver types/speech-recognition.d.ts pros tipos). Sempre roda em
 * modo de UMA frase por clique (não contínuo): mais previsível entre
 * navegadores do que o modo contínuo (que tem bugs conhecidos de parar
 * sozinho no Chrome depois de alguns segundos) — pra ditar mais, clica de
 * novo. O objetivo aqui é digitar rápido um título/nota curta, não uma
 * transcrição longa.
 *
 * A SpeechRecognition em si não expõe o volume do microfone — pra mostrar
 * uma reação de verdade enquanto a pessoa fala (não só um pulso genérico),
 * abre um segundo getUserMedia só pra visualização (mesma técnica de
 * components/whatsapp-chat.tsx's AudioForm: AnalyserNode + requestAnimationFrame
 * lendo o volume por faixa de frequência), em paralelo à captura própria do
 * reconhecimento — os dois convivem sem conflito, cada um com seu próprio
 * MediaStream do mesmo microfone.
 */
export function VoiceInputButton({
  onResult,
  lang = "pt-BR",
  className = "",
}: {
  /** Chamado com o texto reconhecido (frase inteira) quando termina de falar. */
  onResult: (text: string) => void;
  lang?: string;
  className?: string;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<number[]>(Array(WAVEFORM_BARS).fill(4));
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    setSupported(!!Ctor);
  }, []);

  function stopVisualizer() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLevels(Array(WAVEFORM_BARS).fill(4));
  }

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      stopVisualizer();
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
    },
    [],
  );

  function showError(message: string) {
    if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
    setError(message);
    errorTimeoutRef.current = setTimeout(() => setError(null), ERROR_AUTO_DISMISS_MS);
  }

  async function startVisualizer() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      audioCtxRef.current = audioCtx;
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        const bars = Array.from({ length: WAVEFORM_BARS }, (_, i) => {
          const value = data[Math.floor((i * data.length) / WAVEFORM_BARS)];
          return Math.max(4, Math.round((value / 255) * 22));
        });
        setLevels(bars);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // Sem acesso ao microfone pra visualização não impede o ditado em si
      // (a SpeechRecognition tem sua própria captura) — só fica sem a
      // reação de áudio, o pulso genérico do botão ainda mostra que está ouvindo.
    }
  }

  function toggle() {
    // Trava contra clique/toque duplo: sem isso, dois cliques rápidos antes
    // do re-render refletir `listening=true` criavam DUAS instâncias de
    // SpeechRecognition escutando o mesmo microfone ao mesmo tempo (a
    // segunda sobrescrevia recognitionRef sem nunca parar a primeira).
    if (listening || recognitionRef.current) {
      recognitionRef.current?.stop();
      return;
    }

    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;

    setError(null);
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length })
        .map((_, i) => event.results[i][0].transcript)
        .join(" ")
        .trim();
      if (transcript) onResult(transcript);
    };
    recognition.onerror = (event) => {
      // "no-speech"/"aborted" são silêncio comum (usuário clicou e não falou
      // nada, ou parou por conta própria) — não é erro de verdade, não avisa.
      // Os outros códigos têm causas bem diferentes entre si (mic ausente
      // vs. sem internet vs. permissão negada) — misturar tudo numa mensagem
      // genérica de "tente de novo" manda o vendedor repetir uma ação que
      // vai falhar de novo pelo mesmo motivo.
      if (event.error === "no-speech" || event.error === "aborted") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        showError("Permissão de microfone negada");
      } else if (event.error === "audio-capture") {
        showError("Nenhum microfone encontrado");
      } else if (event.error === "network") {
        // O reconhecimento do Chrome/Edge processa o áudio no servidor deles,
        // não localmente — sem internet (comum pra vendedor em campo), o
        // erro real é conexão, não "não entendi o que você falou".
        showError("Sem conexão com a internet");
      } else {
        showError("Não consegui entender — tente de novo");
      }
    };
    recognition.onend = () => {
      setListening(false);
      stopVisualizer();
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
    startVisualizer();
  }

  if (!supported) return null;

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={toggle}
        className={`icon-btn relative ${listening ? "text-red-500 dark:text-red-400" : ""} ${className}`}
        title={listening ? "Parar ditado" : "Ditar por voz"}
        aria-label={listening ? "Parar ditado" : "Ditar por voz"}
        aria-pressed={listening}
      >
        {listening && (
          <>
            <span className="absolute inset-0 animate-ping rounded-md bg-red-500/30" />
            <span className="absolute inset-0 animate-ping rounded-md bg-red-500/20 [animation-delay:0.5s]" />
          </>
        )}
        {listening ? <MicOff className="relative h-3.5 w-3.5" strokeWidth={2} /> : <Mic className="h-3.5 w-3.5" strokeWidth={2} />}
      </button>

      {listening && (
        <span className="animate-pop-in pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-neutral-900 px-3 py-2 shadow-lg dark:bg-neutral-800">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
          </span>
          <span className="flex h-4 items-end gap-0.5">
            {levels.map((h, i) => (
              <span
                key={i}
                className="w-0.5 rounded-full bg-white transition-[height] duration-75 ease-out"
                style={{ height: `${h}px` }}
              />
            ))}
          </span>
          <span className="text-[11px] font-medium whitespace-nowrap text-white">Ouvindo…</span>
        </span>
      )}

      {error && (
        <span className="absolute top-full left-1/2 z-10 mt-1 w-max max-w-[180px] -translate-x-1/2 rounded-md bg-neutral-900 px-2 py-1 text-center text-[11px] text-white shadow-lg dark:bg-white dark:text-neutral-900">
          {error}
        </span>
      )}
    </span>
  );
}
