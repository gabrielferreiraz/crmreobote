"use client";

/**
 * Preserva os ids de tarefas WHATSAPP pendentes durante a ida-e-volta da
 * dica de produtividade MANY_WHATSAPP_TASKS (popup em Home/qualquer tela)
 * pra tela da Agenda. A tela de agenda lê o rascunho e abre o fluxo de
 * agendar mensagem em massa automaticamente.
 *
 * sessionStorage (não localStorage) de propósito: é um rascunho de uso
 * único desta aba, não deve sobreviver a sessões futuras.
 */

const STORAGE_KEY = "tasks-schedule-draft";

export type TasksScheduleDraft = {
  taskIds: string[];
};

export function saveTasksScheduleDraft(draft: TasksScheduleDraft) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // sessionStorage indisponível (modo privado restrito etc.) — degrada
    // pra "abre a agenda normal sem pré-selecionar", não quebra a navegação.
  }
}

/** Lê e apaga na mesma chamada — restauração de uso único. */
export function popTasksScheduleDraft(): TasksScheduleDraft | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    return JSON.parse(raw) as TasksScheduleDraft;
  } catch {
    return null;
  }
}
