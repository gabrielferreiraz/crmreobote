"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Lembra o último filtro usado nesta tela, neste navegador — sobrevive a F5,
 * fechar a aba e voltar depois, ou navegar pra outra tela e voltar. Não é
 * "salvar um filtro com nome" (preset compartilhável): é só o estado atual
 * persistido sozinho, sem o usuário pedir.
 *
 * `values`: o snapshot atual de todo campo de filtro que deve ser lembrado
 * (um objeto simples, montado de novo a cada render — comparado por
 * conteúdo via JSON, não por referência, então não precisa de useMemo no
 * chamador).
 * `restore`: aplica de volta um objeto (parcial, só os campos que existiam
 * quando foi salvo) assim que a tela monta, caso exista algo salvo.
 *
 * Devolve `hydrated`: true assim que a restauração (ou a confirmação de que
 * não tinha nada salvo) já rodou — quem busca dados de um filtro que pode
 * vir do localStorage (não só da URL/servidor) deve esperar isso virar true
 * antes de decidir se busca ou não, senão arrisca usar o valor ANTIGO
 * (pré-restauração) nessa decisão — ver comentário abaixo.
 */
export function usePersistedFilters<T extends Record<string, unknown>>(
  key: string,
  values: T,
  restore: (saved: Partial<T>) => void,
): { hydrated: boolean } {
  const storageKey = `crm:filters:${key}`;
  // ESTADO, não ref: um ref mutado dentro do efeito de restauração abaixo
  // fica "true" pro efeito de persistência mais embaixo AINDA NO MESMO
  // commit (mesmo ciclo síncrono de efeitos da montagem) — antes dos
  // setState da restauração terem de fato passado por um re-render. Nesse
  // meio-tempo, o efeito de persistência gravava de volta os valores ANTIGOS
  // (pré-restauração, ainda os padrões da tela) por cima do que acabou de
  // ser lido do localStorage. Com estado, o efeito de baixo só "vê"
  // hydrated=true depois que React realmente re-renderizou com os valores
  // já restaurados — a gravação prematura não acontece mais.
  const [hydrated, setHydrated] = useState(false);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  // Só na montagem: aplica o que estiver salvo, se houver.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) restoreRef.current(JSON.parse(raw));
    } catch {
      // localStorage indisponível (modo privado, quota, etc.) — segue com o
      // padrão da tela, sem filtro nenhum lembrado.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const serialized = JSON.stringify(values);
  useEffect(() => {
    // Não sobrescreve o que está salvo com o padrão da tela antes da
    // restauração acima rodar E o re-render com o valor restaurado ter
    // acontecido (senão o valor salvo nunca sobreviveria ao primeiro render).
    if (!hydrated) return;
    try {
      localStorage.setItem(storageKey, serialized);
    } catch {
      // Idem — silencioso de propósito, filtro não persistir não pode
      // quebrar a tela.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, serialized, hydrated]);

  return { hydrated };
}
