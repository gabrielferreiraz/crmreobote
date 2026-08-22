"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { appendDictatedText } from "@/lib/dictation";

const WAVEFORM_BARS = 5;
const ERROR_AUTO_DISMISS_MS = 4000;

// Reexportado só pra não quebrar quem já importava daqui (ver
// lib/dictation.ts pra onde a implementação de fato mora agora).
export { appendDictatedText };

/**
 * Ditado por voz via Web Speech API — nativa do navegador (Chrome/Edge/
 * Safari), sem custo e sem chave de API, mas não é padronizada: só existe
 * prefixada (`webkitSpeechRecognition`) em alguns navegadores e não existe
 * no Firefox (ver types/speech-recognition.d.ts pros tipos). Sempre roda em
 * modo de UMA frase por clique (não contínuo): mais previsível entre
 * navegadores do que o modo contínuo (que tem bugs conhecidos de parar
 * sozinho no Chrome depois de alguns segundos) — pra ditar mais, clica de
 * novo. O objetivo aqui é digitar rápido um título/nota curta, não uma
 * transcrição longa (pra isso, ver `keepListening` abaixo — reencadeia frase
 * por frase sozinho, pra ditar vários campos numa sentada só sem precisar
 * clicar de novo a cada um).
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
  onInterimResult,
  onListeningChange,
  lang = "pt-BR",
  className = "",
  keepListening = false,
}: {
  /** Chamado com o texto reconhecido (frase inteira) quando termina de falar. */
  onResult: (text: string) => void;
  /**
   * Chamado a cada atualização do resultado PROVISÓRIO — a frase ainda
   * sendo reconhecida, antes de fechar (pode mudar até lá). Pensado pra
   * mostrar na tela em tempo real o que a pessoa está falando (ver
   * lib/use-dictated-text.ts), não pra guardar/formatar de verdade — isso
   * continua sendo trabalho só de `onResult`, chamado exatamente uma vez
   * por frase, quando ela fecha (comportamento de sempre, inalterado).
   */
  onInterimResult?: (text: string) => void;
  /**
   * Avisa quando o microfone liga/desliga de verdade — pensado pra quem
   * precisa saber exatamente quando a SESSÃO INTEIRA de ditado acabou (ex.:
   * só processar/distribuir o texto ditado quando a pessoa clicar pra
   * parar, não a cada frase reconhecida no meio do caminho, que ainda pode
   * vir mais coisa). `false` dispara tanto no clique de parar quanto num
   * erro real que encerra a sessão (ver onerror abaixo).
   */
  onListeningChange?: (listening: boolean) => void;
  lang?: string;
  className?: string;
  /**
   * Depois de cada frase reconhecida, reabre o microfone sozinho em vez de
   * esperar um clique novo — pensado pra ditar VÁRIOS campos numa sentada só
   * ("nome fulano... telefone tal... mora em tal cidade..."), não só um
   * título/nota curta (o caso de uso padrão, ver comentário do componente).
   * Continua sozinho até a pessoa clicar de novo pra parar, ou até um erro
   * de verdade acontecer (mic sem permissão, sem internet etc. — aí para,
   * não adianta tentar de novo sozinho). Não é o `continuous: true` nativo
   * da SpeechRecognition (esse tem bug conhecido de parar sozinho no Chrome
   * depois de alguns segundos) — é uma frase de cada vez por baixo dos
   * panos, só reencadeada automaticamente.
   */
  keepListening?: boolean;
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
  // false enquanto a pessoa ainda está "numa sessão" de ditado contínuo —
  // vira true só quando ela mesma clica pra parar (ou o componente
  // desmonta), pra onend saber se deve reabrir o microfone sozinho ou não.
  const stoppedByUserRef = useRef(true);
  // Os handlers da SpeechRecognition (onresult/onend) são montados uma vez
  // dentro de startRecognition() e o reencadeio automático (keepListening)
  // reusa essa MESMA closure a cada frase nova, sem o componente re-
  // renderizar no meio — se lessem `onResult`/`onListeningChange` direto
  // dos props, ficariam presos na versão de quando a sessão começou. Ref
  // sempre atualizada evita isso, mesmo sem nunca ter se confirmado como
  // causa de um bug visto (é barato garantir, então garante).
  const onResultRef = useRef(onResult);
  const onInterimResultRef = useRef(onInterimResult);
  const onListeningChangeRef = useRef(onListeningChange);
  useEffect(() => {
    onResultRef.current = onResult;
    onInterimResultRef.current = onInterimResult;
    onListeningChangeRef.current = onListeningChange;
  });

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
      // Marca "parado" ANTES do abort() — sem isso, onend via abort() via
      // desmontagem via keepListening ainda tentava reabrir o microfone
      // depois que o componente já tinha ido embora.
      stoppedByUserRef.current = true;
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

  /** Cria e inicia uma instância nova de reconhecimento — não reaproveita a
   * anterior (o navegador não deixa reiniciar uma já finalizada), por isso
   * tanto o clique inicial quanto o reencadeio automático (`keepListening`)
   * passam por aqui. */
  function startRecognition() {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = false;
    // Ligado de propósito — sem isso, nada aparece na tela até a frase
    // FECHAR de vez (ver comentário do componente). Com continuous=false,
    // isso só gera atualizações PROVISÓRIAS da mesma frase única em
    // andamento (nunca uma 2ª frase nova) — o evento final continua vindo
    // exatamente igual a antes, só que agora precedido de atualizações
    // parciais que ninguém era obrigado a consumir (onInterimResult é
    // opcional).
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const lastIndex = event.results.length - 1;
      const transcript = Array.from({ length: event.results.length })
        .map((_, i) => event.results[i][0].transcript)
        .join(" ")
        .trim();
      if (!transcript) return;
      if (event.results[lastIndex].isFinal) {
        onResultRef.current(transcript);
      } else {
        onInterimResultRef.current?.(transcript);
      }
    };
    recognition.onerror = (event) => {
      // "no-speech"/"aborted" são silêncio comum (usuário clicou e não falou
      // nada, ou parou por conta própria) — não é erro de verdade, não avisa
      // nem interrompe uma sessão de ditado contínuo (a pessoa pode só estar
      // pensando no próximo campo). Os outros códigos têm causas bem
      // diferentes entre si (mic ausente vs. sem internet vs. permissão
      // negada) — misturar tudo numa mensagem genérica de "tente de novo"
      // manda o vendedor repetir uma ação que vai falhar de novo pelo mesmo
      // motivo, então esses SIM param a sessão (ver stoppedByUserRef abaixo).
      if (event.error === "no-speech" || event.error === "aborted") return;
      stoppedByUserRef.current = true;
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
      recognitionRef.current = null;
      // Reencadeia sozinho enquanto a sessão de ditado contínuo não foi
      // encerrada pela própria pessoa (clique) nem por um erro de verdade —
      // reabre o mic pro próximo campo sem exigir clicar de novo. O
      // visualizador de volume (getUserMedia à parte) continua rodando por
      // baixo, só a SpeechRecognition em si é trocada.
      if (keepListening && !stoppedByUserRef.current) {
        startRecognition();
        return;
      }
      setListening(false);
      stopVisualizer();
      // Só agora a sessão acabou de verdade (clique de parar, ou erro real
      // — nunca no meio de uma frase reencadeada pelo keepListening). É o
      // sinal que quem consome isso pra distribuir campos/analisar o texto
      // ditado espera pra só então processar o texto INTEIRO de uma vez.
      onListeningChangeRef.current?.(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  function toggle() {
    // Trava contra clique/toque duplo: sem isso, dois cliques rápidos antes
    // do re-render refletir `listening=true` criavam DUAS instâncias de
    // SpeechRecognition escutando o mesmo microfone ao mesmo tempo (a
    // segunda sobrescrevia recognitionRef sem nunca parar a primeira).
    if (listening || recognitionRef.current) {
      stoppedByUserRef.current = true;
      recognitionRef.current?.stop();
      return;
    }

    setError(null);
    stoppedByUserRef.current = false;
    setListening(true);
    startRecognition();
    startVisualizer();
    onListeningChangeRef.current?.(true);
  }

  if (!supported) return null;

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={toggle}
        className={`icon-btn relative ${listening ? "text-red-500 dark:text-red-400" : ""} ${className}`}
        title={listening ? "Parar ditado" : keepListening ? "Ditar por voz — fale os campos um de cada vez" : "Ditar por voz"}
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
          <span className="text-[11px] font-medium whitespace-nowrap text-white">
            {keepListening ? "Ouvindo… um campo de cada vez" : "Ouvindo…"}
          </span>
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
