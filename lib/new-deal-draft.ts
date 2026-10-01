"use client";

import type { CustomFieldFormValues } from "@/components/custom-fields-fieldset";

/**
 * Rascunho da aba Manual de "Novo negócio" (ver new-deal-dialog.tsx) —
 * sobrevive a um fechamento ACIDENTAL (clique fora do modal ou Esc), pra não
 * perder o que já foi digitado. Só se perde de propósito: ao clicar no X ou
 * em "Cancelar", as únicas ações que significam de verdade "não quero mais
 * criar isto" — pedido explícito do usuário: "pode ser que o consultor
 * clicou errado e acabou fechando a tela".
 *
 * sessionStorage (não localStorage) — mesmo raciocínio de
 * lib/tasks-schedule-draft.ts: um rascunho de dias atrás reaparecendo
 * sozinho seria mais confuso que útil; dentro da MESMA sessão (o caso real:
 * segundos depois de um clique errado) é exatamente o que ajuda.
 *
 * Por pipeline — um rascunho aberto no funil "Consórcio de Carro" não deve
 * prefixar um "Novo negócio" aberto depois no funil "Imóveis".
 */

const STORAGE_PREFIX = "new-deal-draft:";

export type NewDealDraft = {
  contactId: string;
  /** Guardado junto do id — sem isso, restaurar só o id faz o campo de busca
   * de contato voltar mostrando a CAIXA DE BUSCA vazia (ver
   * ContactSearchInput: só vira o "chip" selecionado quando tem valor E
   * rótulo), mesmo com o contato já escolhido por baixo. */
  contactName: string;
  value: string;
  grossValue: string;
  creditType: string;
  ownerId: string;
  customFieldValues: CustomFieldFormValues;
};

const EMPTY_DRAFT: NewDealDraft = {
  contactId: "",
  contactName: "",
  value: "",
  grossValue: "",
  creditType: "",
  ownerId: "",
  customFieldValues: {},
};

/** ownerId fica de fora de propósito — nasce pré-preenchido com quem está
 * logado (não é algo que a pessoa "digitou"), então sozinho não prova que
 * existe rascunho de verdade pra guardar. */
function isBlank(draft: NewDealDraft): boolean {
  return (
    !draft.contactId &&
    !draft.value &&
    !draft.grossValue &&
    !draft.creditType &&
    Object.keys(draft.customFieldValues).length === 0
  );
}

export function readNewDealDraft(pipelineId: string): NewDealDraft | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + pipelineId);
    if (!raw) return null;
    return { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<NewDealDraft>) };
  } catch {
    return null;
  }
}

export function writeNewDealDraft(pipelineId: string, draft: NewDealDraft): void {
  try {
    // Rascunho vazio (abriu e fechou sem digitar nada) não precisa ocupar a
    // sessionStorage — evita acumular uma chave por pipeline à toa.
    if (isBlank(draft)) {
      sessionStorage.removeItem(STORAGE_PREFIX + pipelineId);
      return;
    }
    sessionStorage.setItem(STORAGE_PREFIX + pipelineId, JSON.stringify(draft));
  } catch {
    // sessionStorage indisponível (aba anônima restrita etc.) — degrada pra
    // "sem rascunho", nunca impede o modal de fechar.
  }
}

export function clearNewDealDraft(pipelineId: string): void {
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + pipelineId);
  } catch {
    /* idem acima */
  }
}
