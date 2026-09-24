/**
 * CNPJ: normalização, validação local e consulta do nome na Receita.
 *
 * Existe pra alimentar a PJ do consultor (ver UserCompany no schema): o
 * Ranking do mês da TV estampa o nome da EMPRESA em vez do nome pessoal de
 * quem tem CNPJ cadastrado.
 */

/** Só os dígitos — é assim que o CNPJ é guardado (UserCompany.cnpj) e
 * comparado, mesma convenção de phoneNormalized no Contact. */
export function normalizeCnpj(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** 00.000.000/0000-00 — só pra exibir; nada é guardado nesse formato. */
export function formatCnpj(raw: string): string {
  const d = normalizeCnpj(raw);
  if (d.length !== 14) return raw;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Peso de cada posição no cálculo dos dígitos verificadores — o 2º dígito
 * entra com um algarismo a mais porque já conta o 1º DV recém-calculado. */
const DV1_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const DV2_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function checkDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce((acc, weight, i) => acc + Number(digits[i]) * weight, 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/**
 * Confere os dois dígitos verificadores. Roda ANTES de qualquer chamada de
 * rede: um número digitado errado é o caso comum, e gastar uma ida à Receita
 * (que tem limite de requisições por minuto) pra descobrir isso é desperdício
 * que ainda por cima come a cota de quem digitou certo.
 */
export function isValidCnpj(raw: string): boolean {
  const d = normalizeCnpj(raw);
  if (d.length !== 14) return false;
  // 11111111111111 e afins passam na conta dos dígitos verificadores, mas não
  // são CNPJ de ninguém — é o placeholder clássico de formulário mal
  // preenchido.
  if (/^(\d)\1{13}$/.test(d)) return false;
  return checkDigit(d, DV1_WEIGHTS) === Number(d[12]) && checkDigit(d, DV2_WEIGHTS) === Number(d[13]);
}

export type CnpjLookup = {
  cnpj: string;
  /** Nome já resolvido pra exibição — ver resolveCompanyName abaixo. */
  name: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  /** "ATIVA", "BAIXADA", "SUSPENSA"… — quem chama decide se liga pro estado. */
  situacao: string | null;
};

/**
 * Nome que vai pra tela: fantasia quando existe, razão social quando não
 * (decisão explícita do usuário). MEI quase nunca tem fantasia preenchida na
 * Receita, e razão social vazia não existe — então esta função sempre devolve
 * alguma coisa pra um CNPJ real.
 */
function resolveCompanyName(razaoSocial: string, nomeFantasia: string | null): string {
  const fantasia = nomeFantasia?.trim();
  return fantasia && fantasia.length > 0 ? fantasia : razaoSocial.trim();
}

export class CnpjLookupError extends Error {
  constructor(
    message: string,
    /** Status HTTP que a rota deve devolver — separa "o número não existe"
     * (404, culpa de quem digitou) de "a Receita não respondeu" (502, não é
     * culpa de ninguém aqui e vale tentar de novo depois). */
    readonly status: number,
  ) {
    super(message);
    this.name = "CnpjLookupError";
  }
}

/** Fonte pública, sem chave de API e sem cadastro — é um proxy da própria
 * Receita mantido pelo projeto BrasilAPI. */
const BRASIL_API_CNPJ = "https://brasilapi.com.br/api/cnpj/v1";
/** Teto de espera: a rota que chama isto está no caminho de um clique de
 * usuário, e a Receita às vezes fica minutos sem responder. Melhor um erro
 * rápido e claro ("tente de novo") do que a tela pendurada. */
const LOOKUP_TIMEOUT_MS = 8000;

/**
 * Busca o nome da empresa a partir do CNPJ.
 *
 * Valida o número localmente antes de sair pela rede (ver isValidCnpj) e
 * traduz as falhas da fonte externa em erros com status próprio, pra rota não
 * precisar conhecer os detalhes da BrasilAPI.
 */
export async function lookupCnpj(raw: string): Promise<CnpjLookup> {
  const cnpj = normalizeCnpj(raw);
  if (!isValidCnpj(cnpj)) {
    throw new CnpjLookupError("CNPJ inválido — confira os números digitados.", 400);
  }

  let res: Response;
  try {
    res = await fetch(`${BRASIL_API_CNPJ}/${cnpj}`, {
      headers: {
        Accept: "application/json",
        // Obrigatório: sem User-Agent a BrasilAPI responde 403 Forbidden em
        // TODA requisição (verificado na prática — com o cabeçalho, 200; sem
        // ele, 403 sempre). O valor em si não importa, só a presença.
        "User-Agent": "crm-reobote/1.0",
      },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      // Sem cache do Next: a situação cadastral muda com o tempo e um CNPJ
      // consultado hoje pode estar baixado semana que vem. Quem quiser o
      // valor memorizado guarda em UserCompany, que é o ponto de verdade.
      cache: "no-store",
    });
  } catch {
    throw new CnpjLookupError("Não foi possível consultar a Receita agora. Tente de novo em instantes.", 502);
  }

  if (res.status === 404) {
    throw new CnpjLookupError("CNPJ não encontrado na Receita Federal.", 404);
  }
  if (res.status === 429) {
    throw new CnpjLookupError("Muitas consultas seguidas à Receita. Aguarde um minuto e tente de novo.", 429);
  }
  if (!res.ok) {
    throw new CnpjLookupError("A Receita não respondeu como esperado. Tente de novo em instantes.", 502);
  }

  const data = (await res.json().catch(() => null)) as {
    razao_social?: string;
    nome_fantasia?: string | null;
    descricao_situacao_cadastral?: string | null;
  } | null;

  const razaoSocial = data?.razao_social?.trim();
  if (!razaoSocial) {
    // Resposta 200 sem razão social não deveria acontecer — se acontecer, é
    // mudança de contrato da fonte, e seguir em frente gravaria nome vazio.
    throw new CnpjLookupError("A Receita respondeu sem o nome da empresa.", 502);
  }

  const nomeFantasia = data?.nome_fantasia?.trim() || null;
  return {
    cnpj,
    name: resolveCompanyName(razaoSocial, nomeFantasia),
    razaoSocial,
    nomeFantasia,
    situacao: data?.descricao_situacao_cadastral?.trim() || null,
  };
}
