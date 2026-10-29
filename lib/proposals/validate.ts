/**
 * Validação dos campos comerciais de uma Proposta — pura (sem prisma), usada
 * TANTO no servidor (fonte de verdade, nunca confia no que a tela mandou)
 * QUANTO no formulário (mesma regra, mensagem antes de ir pro servidor).
 *
 * Limites vêm do próprio schema: credit/installment são Decimal(12,2) (10
 * dígitos inteiros + 2 casas) — acima disso o Postgres estoura com erro
 * genérico de overflow, aqui vira mensagem clara. Prazo/cotas têm teto de
 * sanidade (não regra de negócio): pegam erro de digitação óbvio ("1800"
 * meses, "20000" cotas) sem inventar um limite comercial que a Reobote não
 * definiu. Deliberadamente NÃO valida `parcela × prazo ≥ crédito` — plano de
 * parcela reduzida (paga parte da parcela até contemplar) faz essa conta dar
 * menor que o crédito de verdade, e uma trava aqui barraria proposta legítima.
 */

const MAX_MONEY = 9_999_999_999.99;
const MAX_PERCENT = 999.99;
const MAX_TERM_MONTHS = 600;
const MAX_QUOTA_COUNT = 999;
const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_DISPLAY_NAME_LENGTH = 120;
const MAX_COVER_TEXT_LENGTH = 500;

export type ProposalFields = {
  /** Total, nunca por cota — ver comentário em Proposal.credit no schema. */
  credit: number;
  termMonths: number;
  installment: number;
  feePercent: number;
  quotaCount: number;
  description: string;
  displayName: string;
  coverIntro: string;
  coverDetails: string;
  coverImagePosition: "before-copy" | "after-title";
  /** Cotas aderidas pelas tabelas Servopa — viram as linhas de ProposalQuota. */
  quotas: ProposalQuotaInput[];
};

export type ProposalQuotaInput = {
  servopaTableId: string;
  groupNumber: string;
  category: string;
  termMonths: number;
  admPercent: number;
  /** Fundo de reserva do grupo; soma com admPercent na taxa impressa. */
  reserveFundPercent: number | null;
  creditValue: number;
  installment: number;
  quotaCount: number;
};

const MAX_QUOTAS = 50;

/**
 * Taxa de uma cota, em 4 casas — `parsePercent` arredonda em 2, que serve pro
 * campo de taxa da proposta mas truncaria o fundo de reserva (0,0458%) e as
 * taxas que a Servopa publica com 4 casas.
 */
function parseRate4(raw: unknown, label: string): Result<number> {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: 0 };
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
  if (!Number.isFinite(n)) return { ok: false, error: `${label} inválida` };
  if (n < 0) return { ok: false, error: `${label} não pode ser negativa` };
  if (n > MAX_PERCENT) return { ok: false, error: `${label} acima do máximo permitido (${MAX_PERCENT}%)` };
  return { ok: true, value: Math.round(n * 10_000) / 10_000 };
}

/**
 * As cotas chegam da tela, então são tratadas como qualquer outro corpo: o
 * servidor refaz a validação inteira. Corpo sem o campo = lista vazia (as
 * propostas feitas à mão, sem passar pelas tabelas, continuam válidas).
 */
function parseQuotas(raw: unknown): Result<ProposalQuotaInput[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Cotas inválidas" };
  if (raw.length > MAX_QUOTAS) return { ok: false, error: `Máximo de ${MAX_QUOTAS} cotas por proposta` };

  const seen = new Set<string>();
  const value: ProposalQuotaInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { ok: false, error: "Cotas inválidas" };
    const q = item as Record<string, unknown>;

    const servopaTableId = typeof q.tableId === "string" ? q.tableId : typeof q.servopaTableId === "string" ? q.servopaTableId : "";
    const groupNumber = typeof q.groupNumber === "string" ? q.groupNumber.trim() : "";
    const category = typeof q.category === "string" ? q.category.trim() : "";
    if (!servopaTableId || !groupNumber || !category) return { ok: false, error: "Cota sem grupo ou categoria" };

    // O par (tabela, categoria) é único no banco; barrar aqui dá mensagem
    // melhor que o P2002 que viria depois.
    const key = `${servopaTableId}:${category}`;
    if (seen.has(key)) return { ok: false, error: `A categoria ${category} do grupo ${groupNumber} está repetida` };
    seen.add(key);

    const termMonths = parseInt_(q.termMonths, `Prazo do grupo ${groupNumber}`, MAX_TERM_MONTHS);
    if (!termMonths.ok) return termMonths;
    const quotaCount = parseInt_(q.cotas ?? q.quotaCount, `Quantidade de cotas do grupo ${groupNumber}`, MAX_QUOTA_COUNT);
    if (!quotaCount.ok) return quotaCount;
    const admPercent = parseRate4(q.admEffective ?? q.admPercent, `Taxa do grupo ${groupNumber}`);
    if (!admPercent.ok) return admPercent;
    // Grupo sem fundo publicado pela Servopa fica nulo — não vira 0, que
    // afirmaria que o fundo é zero.
    const rawFund = q.reserveFundPercent;
    const fund = rawFund === null || rawFund === undefined || rawFund === "" ? null : parseRate4(rawFund, `Fundo de reserva do grupo ${groupNumber}`);
    if (fund && !fund.ok) return fund;
    const creditValue = parseMoney(q.creditValue, `Valor da cota do grupo ${groupNumber}`);
    if (!creditValue.ok) return creditValue;
    const installment = parseMoney(q.installment, `Parcela do grupo ${groupNumber}`);
    if (!installment.ok) return installment;

    value.push({
      servopaTableId,
      groupNumber,
      category,
      termMonths: termMonths.value,
      admPercent: admPercent.value,
      reserveFundPercent: fund ? fund.value : null,
      creditValue: creditValue.value,
      installment: installment.value,
      quotaCount: quotaCount.value,
    });
  }
  return { ok: true, value };
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function parseMoney(raw: unknown, label: string): Result<number> {
  if (raw === null || raw === undefined || raw === "") return { ok: false, error: `${label} é obrigatório` };
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return { ok: false, error: `${label} inválido` };
  if (n <= 0) return { ok: false, error: `${label} precisa ser maior que zero` };
  if (n > MAX_MONEY) return { ok: false, error: `${label} acima do máximo permitido` };
  // 2 casas, arredondado — Number com muitas casas (ex.: divisão) viraria
  // ruído de ponto flutuante no Decimal(12,2).
  return { ok: true, value: Math.round(n * 100) / 100 };
}

function parseInt_(raw: unknown, label: string, max: number): Result<number> {
  if (raw === null || raw === undefined || raw === "") return { ok: false, error: `${label} é obrigatório` };
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n)) return { ok: false, error: `${label} precisa ser um número inteiro` };
  if (n < 1) return { ok: false, error: `${label} precisa ser pelo menos 1` };
  if (n > max) return { ok: false, error: `${label} acima do máximo permitido (${max})` };
  return { ok: true, value: n };
}

function parsePercent(raw: unknown, label: string): Result<number> {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: 0 };
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
  if (!Number.isFinite(n)) return { ok: false, error: `${label} inválida` };
  if (n < 0) return { ok: false, error: `${label} não pode ser negativa` };
  if (n > MAX_PERCENT) return { ok: false, error: `${label} acima do máximo permitido (${MAX_PERCENT}%)` };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

export function parseProposalFields(raw: unknown): Result<ProposalFields> {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Dados da proposta inválidos" };
  const body = raw as Record<string, unknown>;

  const credit = parseMoney(body.credit, "Crédito");
  if (!credit.ok) return credit;
  const installment = parseMoney(body.installment, "Parcela");
  if (!installment.ok) return installment;
  const feePercent = parsePercent(body.feePercent, "Taxa");
  if (!feePercent.ok) return feePercent;
  const termMonths = parseInt_(body.termMonths, "Prazo", MAX_TERM_MONTHS);
  if (!termMonths.ok) return termMonths;
  const quotaCount = parseInt_(body.quotaCount, "Quantidade de cotas", MAX_QUOTA_COUNT);
  if (!quotaCount.ok) return quotaCount;

  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, error: `Descrição acima de ${MAX_DESCRIPTION_LENGTH} caracteres` };
  }

  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) return { ok: false, error: `Nome acima de ${MAX_DISPLAY_NAME_LENGTH} caracteres` };
  const coverIntro = typeof body.coverIntro === "string" ? body.coverIntro.trim() : "";
  const coverDetails = typeof body.coverDetails === "string" ? body.coverDetails.trim() : "";
  if (coverIntro.length > MAX_COVER_TEXT_LENGTH || coverDetails.length > MAX_COVER_TEXT_LENGTH) {
    return { ok: false, error: `Texto da apresentação acima de ${MAX_COVER_TEXT_LENGTH} caracteres` };
  }
  // Corpo sem o campo (ou com valor inválido) usa o padrão atual da capa:
  // foto antes do texto. Só quem pedir "after-title" explicitamente recebe o
  // layout antigo.
  const coverImagePosition = body.coverImagePosition === "after-title" ? "after-title" : "before-copy";

  const quotas = parseQuotas(body.quotas);
  if (!quotas.ok) return quotas;

  return {
    ok: true,
    value: {
      credit: credit.value,
      termMonths: termMonths.value,
      installment: installment.value,
      feePercent: feePercent.value,
      quotaCount: quotaCount.value,
      description,
      displayName,
      coverIntro,
      coverDetails,
      coverImagePosition,
      quotas: quotas.value,
    },
  };
}
