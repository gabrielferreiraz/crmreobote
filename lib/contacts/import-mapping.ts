/**
 * Sentinelas das escolhas da revisão de importação (ver ValueMappings em
 * lib/contacts/import-resolve.ts) — num arquivo à parte porque a tela
 * (components/contact-import-dialog.tsx) precisa delas e import-resolve.ts
 * puxa o leitor de planilha, que não pode ir pro navegador.
 */

/** Cargo: não importar as linhas com este valor. */
export const MAPPING_SKIP = "__skip__";
/** Origem/Responsável: deixar o campo vazio. */
export const MAPPING_NONE = "__none__";
