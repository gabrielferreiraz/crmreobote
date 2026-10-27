/**
 * Contrato entre o robô (worker/) e o CRM — formato do que sai do painel da
 * Servopa (chaves em português, como o robô extrai) e o formato normalizado
 * que o CRM guarda. Ver lib/servopa-tables/parse.ts (um vira o outro).
 */

/** Uma aba "Taxa de Adm - x,xx%" como o robô a lê (tudo texto, igual ao site). */
export type ScrapedTab = {
  aba: string | null;
  cabecalho: string[];
  /** Categoria, Descrição, Valor do Crédito, Prazo, % Mensal, Parcela, Seguro, Observação, Total. */
  linhas: string[][];
};

/** Página de um grupo (/vendas/grupos/{grupo}/S) como o robô a lê. */
export type ScrapedGroup = {
  grupo: string;
  /** "I" = imóveis, "M" = móveis (coluna Segmento da lista). */
  segmento: string;
  /** Tipo de lance consultado pelo robo; hoje a integracao usa somente "S". */
  tp?: "S";
  titulo: string;
  /** Texto da ordem de contemplação/regras. */
  preMessage: string;
  /** Tabela de informações: rótulo ("Vencimento dia:") → valor. */
  info: Record<string, string>;
  tabs: ScrapedTab[];
};

/** Linha da lista de grupos (POST /vendas/grupos) — traz o prazo TOTAL e as vagas. */
export type ScrapedListRow = {
  grupo: string;
  segmento: string;
  meses: string;
  assembleia: string;
  lance: string;
  contemplados: string;
  vagas: string;
};

export type NormalizedRow = {
  position: number;
  category: string;
  description: string;
  /** Decimais como texto ("1075.69") — nunca float, pra não perder centavo. */
  creditValue: string;
  termMonths: number;
  monthlyPercent: string;
  installment: string;
  insurance: string;
  observation: string | null;
  total: string;
};

export type NormalizedTable = {
  /** Taxa de ADM original, 4 casas ("13.0000"). */
  admRatePercent: string;
  termMonths: number;
  rows: NormalizedRow[];
  contentHash: string;
};

export type NormalizedGroup = {
  number: string;
  segment: "REAL_ESTATE" | "MOVABLE";
  totalMonths: number | null;
  vacancies: number | null;
  dueDay: number | null;
  nextAssemblyNumber: string | null;
  nextAssemblyAt: Date | null;
  reserveFundPercent: string | null;
  insuranceRatePercent: string | null;
  insuranceType: string | null;
  groupType: string | null;
  drawType: string | null;
  embeddedBidMaxPercent: string | null;
  membersCount: number | null;
  contemplationText: string;
  rawInfo: Record<string, string>;
  tables: NormalizedTable[];
  contentHash: string;
};
