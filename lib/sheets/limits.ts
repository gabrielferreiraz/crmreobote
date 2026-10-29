/**
 * Tetos do módulo Planilhas. Existem para uma pessoa (ou uma integração com
 * defeito) nunca conseguir derrubar o banco: o JSON de uma linha é lido
 * inteiro a cada consulta, então tamanho de célula e nº de colunas importam.
 */
export const SHEET_LIMITS = {
  sheetsPerOrg: 500,
  columnsPerSheet: 150,
  rowsPerSheet: 50_000,
  textChars: 1_000,
  longTextChars: 10_000,
  optionsPerColumn: 200,
  optionChars: 100,
  nameChars: 120,
  descriptionChars: 2_000,
  /** Linhas por página na listagem (tela e API). */
  pageSizeMax: 500,
  /** Linhas por chamada de escrita em lote (colar do Excel, API). */
  batchRows: 5_000,
  /** Tamanho máximo do corpo JSON ao colar/atualizar linhas em lote (64 MB — antes era 4 MB). */
  pasteBodyBytes: 64 * 1024 * 1024,
  /** Tamanho máximo de arquivo .xlsx/.csv na importação (25 MB). */
  importFileBytes: 25 * 1024 * 1024,
  /** Importação de .xlsx/.csv: linhas além do cabeçalho. */
  importRows: 20_000,
  importColumns: 150,
  exportRows: 50_000,
} as const;
