"use client";

/**
 * Rascunho do "Novo contato" rápido (ver QuickCreateContactModal em
 * components/contact-search-input.tsx, aberto de dentro de "Novo negócio",
 * "Nova tarefa" e "Editar tarefa") — mesma regra de new-deal-draft.ts:
 * sobrevive a fechamento ACIDENTAL (clique fora / Esc), só some de propósito
 * no X ou em "Cancelar".
 *
 * Uma chave só, sem escopo por onde foi aberto — é o MESMO contato em
 * potencial não importa de qual das 3 telas a pessoa começou a digitar;
 * reaparecer em qualquer uma delas é o comportamento certo, não uma
 * confusão. sessionStorage pelo mesmo motivo de sempre: só faz sentido
 * dentro da mesma sessão.
 */

const STORAGE_KEY = "quick-contact-draft";

export type QuickContactDraft = {
  name: string;
  whatsapp: string;
  phone: string;
  email: string;
  jobTitle: string;
  source: string;
};

const EMPTY_DRAFT: QuickContactDraft = {
  name: "",
  whatsapp: "",
  phone: "",
  email: "",
  jobTitle: "",
  source: "",
};

function isBlank(draft: QuickContactDraft): boolean {
  return Object.values(draft).every((v) => !v);
}

export function readQuickContactDraft(): QuickContactDraft | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<QuickContactDraft>) };
  } catch {
    return null;
  }
}

export function writeQuickContactDraft(draft: QuickContactDraft): void {
  try {
    if (isBlank(draft)) {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // sessionStorage indisponível — degrada pra "sem rascunho".
  }
}

export function clearQuickContactDraft(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* idem acima */
  }
}
