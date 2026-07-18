"use client";

/**
 * Preserva filtro/seleção de Pipeline → Lista durante a ida-e-volta pra
 * criar um script novo (ver components/bulk-send-message-dialog.tsx) — como
 * a view e os filtros de deals-list.tsx são só useState local, navegar pra
 * /whatsapp/scripts/novo e voltar perderia tudo sem isso. sessionStorage (não
 * localStorage) de propósito: é um rascunho de uso único desta aba, não algo
 * que deve sobreviver a sessões futuras.
 */

const STORAGE_KEY = "pipeline-bulk-send-draft";

export type BulkSendDraft = {
  filters: Record<string, string>;
  selectedIds: string[];
};

export function saveBulkSendDraft(draft: BulkSendDraft) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // sessionStorage indisponível (modo privado restrito etc.) — degrada
    // pra "perde o filtro na volta", não quebra a navegação.
  }
}

/** Lê e apaga na mesma chamada — restauração de uso único, nunca fica presa pra sempre. */
export function popBulkSendDraft(): BulkSendDraft | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    return JSON.parse(raw) as BulkSendDraft;
  } catch {
    return null;
  }
}
