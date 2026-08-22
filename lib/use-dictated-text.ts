"use client";

import { useCallback, useState } from "react";

/**
 * Estado de um campo ditado por voz com pré-visualização ao vivo — separa o
 * texto já CONFIRMADO (frase que terminou de verdade) do texto AINDA SENDO
 * falado (resultado provisório da Web Speech API, ver
 * components/voice-input-button.tsx's `onInterimResult`). A tela mostra os
 * dois juntos em tempo real (`value`), mas só o confirmado passa pela
 * formatação de verdade (capitalizar, pontuar, separar "Rótulo: valor"...)
 * — o provisório nunca é formatado (a frase ainda pode mudar até fechar),
 * só concatenado cru, pra dar feedback visual imediato de "entendi o que
 * você está falando" sem esperar a frase terminar.
 *
 * Reaproveitado pelos 5 pontos de ditado do sistema (nota de negócio,
 * título/descrição de tarefa, texto do Registro Rápido) — antes cada um
 * reimplementava a própria concatenação (e uma das cópias, a versão mobile
 * da nota de negócio, nem usava `appendDictatedText`, perdendo a
 * capitalização/pontuação que a versão desktop já tinha).
 */
export function useDictatedText(
  initial: string,
  /** Formata e emenda uma frase JÁ CONFIRMADA no texto existente — ex.: appendDictatedText (prosa corrida) ou appendDictatedLeadText (Registro Rápido, formato "Rótulo: valor"). */
  commit: (committed: string, finalPhrase: string) => string,
) {
  const [committed, setCommittedState] = useState(initial);
  const [interim, setInterim] = useState("");

  // O que a tela mostra: confirmado + provisório cru concatenado (sem
  // formatar) — só existe enquanto a frase atual ainda não fechou.
  const value = interim ? `${committed}${committed && !/\s$/.test(committed) ? " " : ""}${interim}` : committed;

  const onInterimResult = useCallback((text: string) => setInterim(text), []);

  const onResult = useCallback(
    (text: string) => {
      setCommittedState((prev) => commit(prev, text));
      setInterim("");
    },
    [commit],
  );

  /** Edição manual direta (a pessoa digitando por cima do campo) — sempre limpa o provisório, nunca deixa resquício de fala solto por trás do que foi digitado. */
  const setValue = useCallback((v: string) => {
    setCommittedState(v);
    setInterim("");
  }, []);

  return { value, committed, onInterimResult, onResult, setValue };
}
