"use client";

import { useEffect, useRef } from "react";

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
 */
export function usePersistedFilters<T extends Record<string, unknown>>(
  key: string,
  values: T,
  restore: (saved: Partial<T>) => void,
) {
  const storageKey = `crm:filters:${key}`;
  const hydrating = useRef(true);
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
    hydrating.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const serialized = JSON.stringify(values);
  useEffect(() => {
    // Não sobrescreve o que está salvo com o padrão da tela antes da
    // restauração acima rodar (senão o valor salvo nunca sobreviveria ao
    // primeiro render).
    if (hydrating.current) return;
    try {
      localStorage.setItem(storageKey, serialized);
    } catch {
      // Idem — silencioso de propósito, filtro não persistir não pode
      // quebrar a tela.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, serialized]);
}
