"use client";

import { useCallback, useEffect, useState } from "react";
import { TranscriptEngine } from "@/lib/voice/transcript-engine";

/**
 * Substitui lib/use-dictated-text.ts — MESMA superfície pública (`value`,
 * `committed`, `onInterimResult`, `onResult`, `setValue`), agora apoiada em
 * TranscriptEngine (lib/voice/transcript-engine.ts) em vez de um `useState`
 * cru com concatenação na mão. Os 5 pontos de ditado do sistema continuam
 * chamando isto exatamente como chamavam `useDictatedText` — só o import
 * muda.
 *
 * `commit` continua sendo o ponto de customização por domínio: prosa
 * (nota de negócio, título/descrição de tarefa) usa `appendDictatedText`
 * (lib/dictation.ts, agora apoiado no pipeline determinístico — ver
 * lib/voice/pipeline.ts); o Registro Rápido usa `appendDictatedLeadText`
 * (varredura de rótulos, precisa do texto CRU, nunca passa pelo pipeline de
 * prosa). Resincronizado a cada render (ver useEffect abaixo) pra nunca
 * ficar preso numa versão antiga de `commit` se a função passada mudar de
 * identidade entre renders.
 */
export function useVoiceTranscription(
  initial: string,
  commit: (committed: string, finalPhrase: string) => string,
  language = "pt-BR",
) {
  const [engine] = useState(() => new TranscriptEngine(language, commit, initial));

  // Resincroniza a cada render (efeito, nunca durante o render em si — ver
  // react-hooks/refs) — evita a engine ficar presa numa versão antiga de
  // `commit`/`language` se um dos dois mudar entre renders (nenhum dos 3
  // pontos de ditado troca `language` em runtime hoje, mas manter isso
  // sincronizado é uma linha, e evita o mesmo tipo de regressão silenciosa
  // já corrigida do lado de VoiceSessionManager/voice-input-button.tsx).
  useEffect(() => {
    engine.setProcessor(commit);
    engine.setLanguage(language);
  });

  // Só um contador pra forçar re-render — o estado de verdade mora dentro
  // do TranscriptEngine (framework-agnostic, testável sem React).
  const [, setRenderTick] = useState(0);
  const rerender = useCallback(() => setRenderTick((n) => n + 1), []);

  const onInterimResult = useCallback(
    (text: string) => {
      engine.setInterim(text);
      rerender();
    },
    [engine, rerender],
  );

  const onResult = useCallback(
    (text: string) => {
      engine.commitFinal(text, null);
      rerender();
    },
    [engine, rerender],
  );

  /** Edição manual direta (a pessoa digitando por cima do campo). */
  const setValue = useCallback(
    (v: string) => {
      engine.setCommittedText(v);
      rerender();
    },
    [engine, rerender],
  );

  return {
    value: engine.displayText,
    committed: engine.confirmedText,
    onInterimResult,
    onResult,
    setValue,
  };
}
