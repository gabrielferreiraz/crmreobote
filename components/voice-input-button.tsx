"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, Loader2, AlertCircle } from "lucide-react";
import { appendDictatedText } from "@/lib/dictation";
import { VoiceSessionManager } from "@/lib/voice/voice-session-manager";

const WAVEFORM_BARS = 4;

// Reexportado só pra não quebrar quem já importava daqui (ver
// lib/dictation.ts pra onde a implementação de fato mora agora).
export { appendDictatedText };

/**
 * Ditado por voz — UI Adapter fino sobre o subsistema de voz
 * (lib/voice/*.ts): não fala com `window.SpeechRecognition` nem com
 * `getUserMedia`/`AnalyserNode` diretamente, só com um
 * `VoiceSessionManager` (mesmo contrato de `useSyncExternalStore`). Toda a
 * inteligência (reencadeamento de frase, restart com backoff, animação por
 * nível real de áudio, mensagem de erro compreensível) mora lá — este
 * componente só traduz o snapshot da sessão pra ícone/rótulo/aria e repassa
 * os eventos crus (texto reconhecido, sem nenhum processamento de
 * linguagem — isso é decisão de quem consome `onResult`, ver
 * lib/dictation.ts e lib/quick-register/format-dictated-lead-text.ts) pros
 * props de sempre.
 *
 * Pílula com RÓTULO DE TEXTO em vez de só ícone — pedido explícito do
 * usuário depois de ver o botão só-ícone passar despercebido: um ícone
 * exige já saber o que ele significa; texto não exige nada. O texto muda
 * junto do estado ("Ditar por voz" → "Ouvindo…" → "Processando…" → mensagem
 * de erro), então a mesma pílula já é a "legenda ao vivo" que antes vivia
 * numa bolha flutuante à parte — um elemento só pra acompanhar, não dois.
 *
 * API pública INALTERADA (mesmos props de antes) — os pontos de consumo
 * (deal-detail.tsx, tasks-list.tsx, quick-register-deal-form.tsx) não
 * precisaram mudar a lógica, só o layout ao redor pra dar espaço à pílula
 * (era pensada pra um ícone de 28px num canto, agora é mais larga).
 */
export function VoiceInputButton({
  onResult,
  onInterimResult,
  onListeningChange,
  lang = "pt-BR",
  className = "",
}: {
  /** Chamado com o texto reconhecido (frase inteira) quando termina de falar — sempre CRU, sem pontuação/vocabulário/capitalização aplicados (quem consome decide o processamento). */
  onResult: (text: string) => void;
  /** Chamado a cada atualização do resultado PROVISÓRIO — pensado pra mostrar na tela em tempo real o que a pessoa está falando, nunca pra guardar/formatar de verdade. */
  onInterimResult?: (text: string) => void;
  /** Avisa quando a SESSÃO INTEIRA (não uma frase) liga/desliga de verdade — nunca numa pausa comum entre frases. */
  onListeningChange?: (listening: boolean) => void;
  lang?: string;
  className?: string;
}) {
  const onResultRef = useRef(onResult);
  const onInterimResultRef = useRef(onInterimResult);
  const onListeningChangeRef = useRef(onListeningChange);
  useEffect(() => {
    onResultRef.current = onResult;
    onInterimResultRef.current = onInterimResult;
    onListeningChangeRef.current = onListeningChange;
  });

  // Uma sessão por instância do botão — o inicializador de useState só
  // roda 1x (React garante), então a classe nasce uma vez só, nunca de
  // novo a cada render (ref.current lido/escrito durante o render é
  // desencorajado pelo próprio React — ver react-hooks/refs).
  const [manager] = useState(() => new VoiceSessionManager(lang, WAVEFORM_BARS));

  const subscribe = useCallback((listener: () => void) => manager.subscribe(listener), [manager]);
  const getSnapshot = useCallback(() => manager.getSnapshot(), [manager]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // `lang` só é lido de verdade na criação da sessão acima (useState só
  // roda 1x) — sem isto, um `lang` que mudasse depois do 1º render seria
  // ignorado pro resto da vida do componente. Nenhum consumidor troca
  // `lang` em runtime hoje, mas manter isso sincronizado custa uma linha.
  useEffect(() => {
    manager.setLanguage(lang);
  }, [manager, lang]);

  useEffect(() => () => manager.destroy(), [manager]);

  if (!manager.isSupported) return null;

  const listening = snapshot.state === "LISTENING" || snapshot.state === "STARTING";
  const processing = snapshot.state === "PROCESSING";
  const hasError = snapshot.state === "ERROR" && !!snapshot.error;

  function toggle() {
    if (listening || processing) {
      manager.stop();
      return;
    }
    manager.start({
      onInterim: (text) => onInterimResultRef.current?.(text),
      onFinal: (text) => onResultRef.current(text),
      onListeningChange: (l) => onListeningChangeRef.current?.(l),
    });
  }

  // Mesmo texto usado no rótulo visível, no `title` (hover no mouse) e no
  // anúncio pra leitor de tela — uma fonte só de verdade, nunca 3 frases
  // parecidas mas ligeiramente diferentes descrevendo o mesmo estado.
  const stateText = processing
    ? "Processando…"
    : hasError
      ? (snapshot.error?.userMessage ?? "Erro no ditado")
      : snapshot.state === "STARTING"
        ? "Iniciando…"
        : snapshot.state === "LISTENING"
          ? "Ouvindo…"
          : "Ditar por voz";

  const title = listening ? "Toque para parar de ditar" : hasError ? stateText : "Ditar por voz — pode fazer pausas, só para quando você tocar de novo";

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={toggle}
        disabled={processing}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 ${
          listening
            ? "bg-red-500 text-white hover:bg-red-600 active:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600"
            : hasError
              ? "bg-amber-50 text-amber-700 ring-1 ring-amber-300 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-700/50 dark:hover:bg-amber-500/15"
              : // Estado padrão: pílula com a cor de marca (mesmo tom de "Registrar"
                // e de outros acentos do sistema — ver components/badge.tsx) em vez
                // de cinza neutro igual a todo resto da tela, E com o texto "Ditar
                // por voz" sempre visível — não só um ícone que exige já saber o
                // que ele faz. Sem brilho piscando (o projeto evita animate-pulse
                // de propósito — ver comentário do skeleton-shimmer em
                // app/globals.css: "pisca" lê como barato, não como elegante); a
                // cor + o texto já bastam pra chamar atenção sem exagero.
                "bg-brand-light text-brand hover:bg-brand-light-hover dark:bg-brand-light dark:text-brand dark:hover:bg-brand-light-hover"
        } ${className}`}
        title={title}
        aria-label={listening ? "Parar ditado" : "Ditar por voz"}
        aria-pressed={listening}
      >
        {listening && (
          // Pontinho pulsante — mesma linguagem de "gravando" que qualquer
          // app de voz/câmera usa, só que compacto o bastante pra caber ao
          // lado do texto numa pílula (diferente do anel cobrindo o botão
          // inteiro, que ficava estranho numa forma larga em vez de um
          // círculo pequeno).
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
          </span>
        )}
        {processing ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={2} />
        ) : hasError ? (
          <AlertCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        ) : (
          // Sempre "Mic" — nunca "MicOff" enquanto ouve: o ícone descreve o
          // ESTADO DO MICROFONE (ligado), não a ação do clique (que seria
          // "parar"). Um ícone de mic mutado bem no momento em que ele está
          // mais ativo do que nunca lia como o oposto do que está acontecendo.
          <Mic className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        )}
        <span>{stateText}</span>
        {listening && (
          <span className="flex h-3 items-end gap-0.5">
            {/* Altura reage ao nível REAL do microfone por faixa de frequência
                (ver lib/voice/audio-monitor.ts) — silêncio fica quase parado,
                fala intensa estica até o teto. Nunca um pulso genérico igual
                pra todo mundo. Embutido na própria pílula agora (antes vivia
                numa bolha flutuante à parte, um elemento a mais pra notar). */}
            {(snapshot.audioBars.length ? snapshot.audioBars : Array(WAVEFORM_BARS).fill(0)).map((level, i) => (
              <span
                key={i}
                className="w-0.5 rounded-full bg-white transition-[height] duration-75 ease-out"
                style={{ height: `${Math.max(3, Math.round(level * 12))}px` }}
              />
            ))}
          </span>
        )}
      </button>

      {/* Só pra leitor de tela — visualmente invisível (sr-only), nunca
          depende só da animação/cor pra avisar troca de estado. Vazio em
          IDLE/STOPPED de propósito (nada relevante aconteceu ainda, não
          vale interromper o leitor de tela à toa assim que o campo aparece
          na tela). */}
      <span aria-live="polite" className="sr-only">
        {snapshot.state === "IDLE" || snapshot.state === "STOPPED" ? "" : stateText}
      </span>
    </span>
  );
}
