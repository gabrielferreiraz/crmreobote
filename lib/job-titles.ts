/**
 * Lista fixa de cargos/profissões — vira Select em vez de texto livre de
 * propósito: "Advogado", "advogado" e "ADV" são 3 valores diferentes pra um
 * filtro, e é exatamente o lead que a busca não acha que a gente mais quer
 * achar. Ajuste esta lista conforme o perfil de cliente do negócio mudar.
 */
export const JOB_TITLE_OPTIONS = [
  "Médico(a)",
  "Advogado(a)",
  "Empresário(a)",
  "Pessoa Física",
  "Dentista",
  "Engenheiro(a)",
  "Contador(a)",
  "Servidor(a) Público(a)",
  "Autônomo(a)",
  "Produtor(a) Rural",
  "Aposentado(a)",
  "Outro",
];

/**
 * Opções do Select incluindo o valor atual como item extra (marcado
 * "antigo") quando ele não bate com nenhuma opção da lista fixa — pra nunca
 * esconder um cargo já cadastrado em texto livre antes dessa lista existir.
 * Sem isso, o Select mostraria "Selecione" pra um contato que já tem cargo
 * preenchido, parecendo que o dado sumiu.
 */
export function jobTitleSelectOptions(currentValue?: string | null) {
  const options = JOB_TITLE_OPTIONS.map((v) => ({ value: v, label: v }));
  if (currentValue && !JOB_TITLE_OPTIONS.includes(currentValue)) {
    return [{ value: currentValue, label: `${currentValue} (antigo)` }, ...options];
  }
  return options;
}
