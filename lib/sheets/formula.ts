/**
 * Motor de fórmulas das Planilhas, no jeito do Excel em português.
 *
 * Sintaxe: "=" + expressão; argumentos separados por ";" (vírgula também é
 * aceita quando não faz parte de um número); vírgula decimal; nomes de
 * função em português (SOMA, PROCV…) ou inglês (SUM, VLOOKUP…), com ou sem
 * acento; referências A1, $A$1, intervalos B2:C10 e colunas inteiras C:C;
 * operadores + - * / ^ & = <> < > <= >= e % ; erros #DIV/0!, #VALOR!,
 * #REF!, #NOME?, #N/D, #NÚM!.
 *
 * Armazenamento (engenharia reversa do que o Excel faz por dentro, o estilo
 * R1C1): a fórmula é guardada com a COLUNA pelo id (renomear/mover/inserir
 * coluna não quebra nada) e a LINHA relativa à própria célula (~-1 = linha
 * de cima) ou absoluta ($5) quando o usuário escreveu $. Arrastar a fórmula
 * para baixo é só copiar o texto interno — as referências relativas
 * "andam" sozinhas, como no Excel. Linhas são as da ordem "real" da planilha
 * (posição), não a da visão filtrada/ordenada.
 *
 * Arquivo puro (sem servidor): a tela calcula; a exportação converte para
 * fórmula do Excel (inglês, vírgula) para o .xlsx continuar vivo.
 */

import type { CellValue, SheetColumnType } from "@/lib/sheets/column-types";
import { parseLooseDate, parseLooseNumber } from "@/lib/sheets/column-types";

// ─── Valores e erros ─────────────────────────────────────────────────

export type ErrCode = "#DIV/0!" | "#VALOR!" | "#REF!" | "#NOME?" | "#N/D" | "#NÚM!" | "#NULO!";
export class FormulaError {
  readonly code: ErrCode;
  constructor(code: ErrCode) {
    this.code = code;
  }
  toString() {
    return this.code;
  }
}
export type Scalar = number | string | boolean | null | FormulaError;
type Matrix = Scalar[][];
type Val = Scalar | Matrix;

const ERR = {
  div: () => new FormulaError("#DIV/0!"),
  value: () => new FormulaError("#VALOR!"),
  ref: () => new FormulaError("#REF!"),
  name: () => new FormulaError("#NOME?"),
  na: () => new FormulaError("#N/D"),
  num: () => new FormulaError("#NÚM!"),
};
const isErr = (v: unknown): v is FormulaError => v instanceof FormulaError;
const isMatrix = (v: Val): v is Matrix => Array.isArray(v);

export const MAX_FORMULA_CHARS = 2000;

// ─── Datas (número de série do Excel: dias desde 30/12/1899) ─────────

const EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86_400_000;
export function isoToSerial(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY);
}
export function serialToIso(serial: number): string {
  const dt = new Date(EPOCH + Math.floor(serial) * DAY);
  return `${dt.getUTCFullYear().toString().padStart(4, "0")}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
function serialParts(serial: number) {
  const dt = new Date(EPOCH + Math.floor(serial) * DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay() };
}
function partsToSerial(y: number, m: number, d: number) {
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY);
}
/**
 * Hoje no fuso do Brasil usado pelo CRM (America/Campo_Grande, o mesmo de
 * lib/timezone.ts). Fixo de propósito: a tela e o servidor (recálculo da API)
 * precisam concordar, senão um gravaria uma data e o outro outra, sem parar.
 */
export const FORMULA_TIMEZONE = "America/Campo_Grande";
function brazilClock(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: FORMULA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}
export function todaySerial(now = new Date()) {
  const c = brazilClock(now);
  return partsToSerial(c.y, c.m, c.d);
}

// ─── Letras de coluna ────────────────────────────────────────────────

export function letterToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function indexToLetter(index: number): string {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ─── Funções (nome em português + apelidos) ──────────────────────────

export type FunctionInfo = { name: string; en: string; signature: string; description: string };

/** Catálogo exibido no autocompletar (mesmos nomes e assinaturas do Excel em português). */
export const FUNCTIONS: FunctionInfo[] = [
  { name: "SOMA", en: "SUM", signature: "SOMA(núm1; [núm2]; ...)", description: "Soma os números" },
  { name: "MÉDIA", en: "AVERAGE", signature: "MÉDIA(núm1; [núm2]; ...)", description: "Média aritmética" },
  { name: "MÍNIMO", en: "MIN", signature: "MÍNIMO(núm1; [núm2]; ...)", description: "Menor valor" },
  { name: "MÁXIMO", en: "MAX", signature: "MÁXIMO(núm1; [núm2]; ...)", description: "Maior valor" },
  { name: "CONT.NÚM", en: "COUNT", signature: "CONT.NÚM(valor1; [valor2]; ...)", description: "Conta células com números" },
  { name: "CONT.VALORES", en: "COUNTA", signature: "CONT.VALORES(valor1; [valor2]; ...)", description: "Conta células não vazias" },
  { name: "CONTAR.VAZIO", en: "COUNTBLANK", signature: "CONTAR.VAZIO(intervalo)", description: "Conta células vazias" },
  { name: "SE", en: "IF", signature: "SE(teste_lógico; [valor_se_verdadeiro]; [valor_se_falso])", description: "Escolhe um valor conforme uma condição" },
  { name: "SES", en: "IFS", signature: "SES(teste1; valor1; [teste2; valor2]; ...)", description: "Várias condições em sequência" },
  { name: "E", en: "AND", signature: "E(lógico1; [lógico2]; ...)", description: "VERDADEIRO se todos forem verdadeiros" },
  { name: "OU", en: "OR", signature: "OU(lógico1; [lógico2]; ...)", description: "VERDADEIRO se algum for verdadeiro" },
  { name: "NÃO", en: "NOT", signature: "NÃO(lógico)", description: "Inverte o valor lógico" },
  { name: "SEERRO", en: "IFERROR", signature: "SEERRO(valor; valor_se_erro)", description: "Valor alternativo em caso de erro" },
  { name: "SENÃODISP", en: "IFNA", signature: "SENÃODISP(valor; valor_se_nd)", description: "Valor alternativo para #N/D" },
  { name: "ÉCÉL.VAZIA", en: "ISBLANK", signature: "ÉCÉL.VAZIA(valor)", description: "VERDADEIRO se estiver vazia" },
  { name: "ÉNÚM", en: "ISNUMBER", signature: "ÉNÚM(valor)", description: "VERDADEIRO se for número" },
  { name: "ÉTEXTO", en: "ISTEXT", signature: "ÉTEXTO(valor)", description: "VERDADEIRO se for texto" },
  { name: "ÉERROS", en: "ISERROR", signature: "ÉERROS(valor)", description: "VERDADEIRO se for erro" },
  { name: "SOMASE", en: "SUMIF", signature: "SOMASE(intervalo; critérios; [intervalo_soma])", description: "Soma conforme um critério" },
  { name: "SOMASES", en: "SUMIFS", signature: "SOMASES(intervalo_soma; intervalo_critérios1; critérios1; ...)", description: "Soma conforme vários critérios" },
  { name: "SOMARPRODUTO", en: "SUMPRODUCT", signature: "SOMARPRODUTO(matriz1; [matriz2]; ...)", description: "Soma os produtos de matrizes correspondentes" },
  { name: "CONT.SE", en: "COUNTIF", signature: "CONT.SE(intervalo; critérios)", description: "Conta conforme um critério" },
  { name: "CONT.SES", en: "COUNTIFS", signature: "CONT.SES(intervalo_critérios1; critérios1; ...)", description: "Conta conforme vários critérios" },
  { name: "MÉDIASE", en: "AVERAGEIF", signature: "MÉDIASE(intervalo; critérios; [intervalo_média])", description: "Média conforme um critério" },
  { name: "MÉDIASES", en: "AVERAGEIFS", signature: "MÉDIASES(intervalo_média; intervalo_critérios1; critérios1; ...)", description: "Média conforme vários critérios" },
  { name: "MÁXIMOSES", en: "MAXIFS", signature: "MÁXIMOSES(intervalo_máximo; intervalo_critérios1; critérios1; ...)", description: "Maior valor conforme vários critérios" },
  { name: "MÍNIMOSES", en: "MINIFS", signature: "MÍNIMOSES(intervalo_mínimo; intervalo_critérios1; critérios1; ...)", description: "Menor valor conforme vários critérios" },
  { name: "PROCV", en: "VLOOKUP", signature: "PROCV(valor_procurado; matriz_tabela; núm_índice_coluna; [procurar_intervalo])", description: "Procura na 1ª coluna e devolve da coluna indicada" },
  { name: "PROCH", en: "HLOOKUP", signature: "PROCH(valor_procurado; matriz_tabela; núm_índice_lin; [procurar_intervalo])", description: "Procura na 1ª linha e devolve da linha indicada" },
  { name: "PROCX", en: "XLOOKUP", signature: "PROCX(pesquisa_valor; pesquisa_matriz; matriz_retorno; [se_não_encontrada])", description: "Procura e devolve o correspondente" },
  { name: "ÍNDICE", en: "INDEX", signature: "ÍNDICE(matriz; núm_linha; [núm_coluna])", description: "Valor numa posição do intervalo" },
  { name: "CORRESP", en: "MATCH", signature: "CORRESP(valor_procurado; matriz_procurada; [tipo_correspondência])", description: "Posição de um valor no intervalo" },
  { name: "CORRESPX", en: "XMATCH", signature: "CORRESPX(valor_procurado; matriz_procurada; [modo_correspondência]; [modo_pesquisa])", description: "Posição de um valor com correspondência flexível" },
  { name: "ESCOLHER", en: "CHOOSE", signature: "ESCOLHER(núm_índice; valor1; [valor2]; ...)", description: "Escolhe um valor pelo índice" },
  { name: "ARRED", en: "ROUND", signature: "ARRED(número; núm_dígitos)", description: "Arredonda" },
  { name: "ARREDONDAR.PARA.CIMA", en: "ROUNDUP", signature: "ARREDONDAR.PARA.CIMA(número; núm_dígitos)", description: "Arredonda para cima" },
  { name: "ARREDONDAR.PARA.BAIXO", en: "ROUNDDOWN", signature: "ARREDONDAR.PARA.BAIXO(número; núm_dígitos)", description: "Arredonda para baixo" },
  { name: "ARREDMULTB", en: "MROUND", signature: "ARREDMULTB(número; múltiplo)", description: "Arredonda para o múltiplo mais próximo" },
  { name: "TRUNCAR", en: "TRUNC", signature: "TRUNCAR(número; [núm_dígitos])", description: "Trunca um número" },
  { name: "INT", en: "INT", signature: "INT(número)", description: "Parte inteira (para baixo)" },
  { name: "ABS", en: "ABS", signature: "ABS(número)", description: "Valor absoluto" },
  { name: "MOD", en: "MOD", signature: "MOD(número; divisor)", description: "Resto da divisão" },
  { name: "POTÊNCIA", en: "POWER", signature: "POTÊNCIA(núm; potência)", description: "Eleva à potência" },
  { name: "RAIZ", en: "SQRT", signature: "RAIZ(núm)", description: "Raiz quadrada" },
  { name: "PRODUTO", en: "PRODUCT", signature: "PRODUTO(núm1; [núm2]; ...)", description: "Multiplica os números" },
  { name: "MAIOR", en: "LARGE", signature: "MAIOR(matriz; k)", description: "k-ésimo maior valor" },
  { name: "MENOR", en: "SMALL", signature: "MENOR(matriz; k)", description: "k-ésimo menor valor" },
  { name: "MED", en: "MEDIAN", signature: "MED(núm1; [núm2]; ...)", description: "Mediana" },
  { name: "ÉPAR", en: "ISEVEN", signature: "ÉPAR(número)", description: "VERDADEIRO para número par" },
  { name: "ÉIMPAR", en: "ISODD", signature: "ÉIMPAR(número)", description: "VERDADEIRO para número ímpar" },
  { name: "PI", en: "PI", signature: "PI()", description: "3,14159…" },
  { name: "CONCAT", en: "CONCAT", signature: "CONCAT(texto1; [texto2]; ...)", description: "Junta textos" },
  { name: "CONCATENAR", en: "CONCATENATE", signature: "CONCATENAR(texto1; [texto2]; ...)", description: "Junta textos" },
  { name: "UNIRTEXTO", en: "TEXTJOIN", signature: "UNIRTEXTO(delimitador; ignorar_vazio; texto1; ...)", description: "Junta textos com separador" },
  { name: "ESQUERDA", en: "LEFT", signature: "ESQUERDA(texto; [núm_caract])", description: "Primeiros caracteres" },
  { name: "DIREITA", en: "RIGHT", signature: "DIREITA(texto; [núm_caract])", description: "Últimos caracteres" },
  { name: "EXT.TEXTO", en: "MID", signature: "EXT.TEXTO(texto; núm_inicial; núm_caract)", description: "Caracteres do meio" },
  { name: "NÚM.CARACT", en: "LEN", signature: "NÚM.CARACT(texto)", description: "Quantidade de caracteres" },
  { name: "MAIÚSCULA", en: "UPPER", signature: "MAIÚSCULA(texto)", description: "Tudo em maiúsculas" },
  { name: "MINÚSCULA", en: "LOWER", signature: "MINÚSCULA(texto)", description: "Tudo em minúsculas" },
  { name: "PRI.MAIÚSCULA", en: "PROPER", signature: "PRI.MAIÚSCULA(texto)", description: "Primeira letra de cada palavra" },
  { name: "ARRUMAR", en: "TRIM", signature: "ARRUMAR(texto)", description: "Tira espaços extras" },
  { name: "SUBSTITUIR", en: "SUBSTITUTE", signature: "SUBSTITUIR(texto; texto_antigo; novo_texto; [núm_da_ocorrência])", description: "Troca um trecho do texto" },
  { name: "LOCALIZAR", en: "SEARCH", signature: "LOCALIZAR(texto_procurado; no_texto; [núm_inicial])", description: "Posição (sem diferenciar maiúsculas)" },
  { name: "PROCURAR", en: "FIND", signature: "PROCURAR(texto_procurado; no_texto; [núm_inicial])", description: "Posição (diferencia maiúsculas)" },
  { name: "TEXTO", en: "TEXT", signature: "TEXTO(valor; formato_texto)", description: "Formata número/data como texto" },
  { name: "VALOR", en: "VALUE", signature: "VALOR(texto)", description: "Converte texto em número" },
  { name: "REPT", en: "REPT", signature: "REPT(texto; núm_vezes)", description: "Repete um texto" },
  { name: "TIRAR", en: "CLEAN", signature: "TIRAR(texto)", description: "Remove caracteres não imprimíveis" },
  { name: "CARACT", en: "CHAR", signature: "CARACT(número)", description: "Caractere correspondente ao código" },
  { name: "CÓDIGO", en: "CODE", signature: "CÓDIGO(texto)", description: "Código do primeiro caractere" },
  { name: "HOJE", en: "TODAY", signature: "HOJE()", description: "Data de hoje" },
  { name: "AGORA", en: "NOW", signature: "AGORA()", description: "Data e hora atuais" },
  { name: "DATA", en: "DATE", signature: "DATA(ano; mês; dia)", description: "Monta uma data" },
  { name: "ANO", en: "YEAR", signature: "ANO(núm_série)", description: "Ano da data" },
  { name: "MÊS", en: "MONTH", signature: "MÊS(núm_série)", description: "Mês da data" },
  { name: "DIA", en: "DAY", signature: "DIA(núm_série)", description: "Dia da data" },
  { name: "DIAS", en: "DAYS", signature: "DIAS(data_final; data_inicial)", description: "Dias entre duas datas" },
  { name: "DATADIF", en: "DATEDIF", signature: 'DATADIF(data_inicial; data_final; unidade "D"/"M"/"A")', description: "Diferença entre datas" },
  { name: "DIATRABALHOTOTAL", en: "NETWORKDAYS", signature: "DIATRABALHOTOTAL(data_inicial; data_final; [feriados])", description: "Dias úteis entre datas" },
  { name: "DIATRABALHO", en: "WORKDAY", signature: "DIATRABALHO(data_inicial; dias; [feriados])", description: "Data após uma quantidade de dias úteis" },
  { name: "NÚM.SEMANA", en: "WEEKNUM", signature: "NÚM.SEMANA(núm_série; [retornar_tipo])", description: "Número da semana no ano" },
  { name: "DIA.DA.SEMANA", en: "WEEKDAY", signature: "DIA.DA.SEMANA(núm_série; [retornar_tipo])", description: "Dia da semana (1 = domingo)" },
  { name: "FIMMÊS", en: "EOMONTH", signature: "FIMMÊS(data_inicial; meses)", description: "Último dia do mês" },
  { name: "DATAM", en: "EDATE", signature: "DATAM(data_inicial; meses)", description: "Data somando meses" },
  // Financeiras (convenção de sinais do Excel: dinheiro que sai é negativo).
  { name: "PGTO", en: "PMT", signature: "PGTO(taxa; nper; vp; [vf]; [tipo])", description: "Valor da parcela de um financiamento" },
  { name: "VP", en: "PV", signature: "VP(taxa; nper; pgto; [vf]; [tipo])", description: "Valor presente" },
  { name: "VF", en: "FV", signature: "VF(taxa; nper; pgto; [vp]; [tipo])", description: "Valor futuro" },
  { name: "NPER", en: "NPER", signature: "NPER(taxa; pgto; vp; [vf]; [tipo])", description: "Número de parcelas" },
  { name: "TAXA", en: "RATE", signature: "TAXA(nper; pgto; vp; [vf]; [tipo]; [estimativa])", description: "Taxa de juros por período" },
  { name: "IPGTO", en: "IPMT", signature: "IPGTO(taxa; per; nper; vp; [vf]; [tipo])", description: "Juros de uma parcela" },
  { name: "PPGTO", en: "PPMT", signature: "PPGTO(taxa; per; nper; vp; [vf]; [tipo])", description: "Amortização de uma parcela" },
  { name: "VPL", en: "NPV", signature: "VPL(taxa; valor1; [valor2]; ...)", description: "Valor presente líquido" },
  { name: "TIR", en: "IRR", signature: "TIR(valores; [estimativa])", description: "Taxa interna de retorno" },
  // Estatísticas
  { name: "DESVPAD.A", en: "STDEV.S", signature: "DESVPAD.A(núm1; [núm2]; ...)", description: "Desvio padrão (amostra)" },
  { name: "DESVPAD", en: "STDEV", signature: "DESVPAD(núm1; [núm2]; ...)", description: "Desvio padrão (amostra)" },
  { name: "DESVPAD.P", en: "STDEV.P", signature: "DESVPAD.P(núm1; [núm2]; ...)", description: "Desvio padrão (população)" },
  { name: "DESVPADP", en: "STDEVP", signature: "DESVPADP(núm1; [núm2]; ...)", description: "Desvio padrão (população)" },
  { name: "VAR.A", en: "VAR.S", signature: "VAR.A(núm1; [núm2]; ...)", description: "Variância (amostra)" },
  { name: "VAR", en: "VAR", signature: "VAR(núm1; [núm2]; ...)", description: "Variância (amostra)" },
  { name: "VAR.P", en: "VAR.P", signature: "VAR.P(núm1; [núm2]; ...)", description: "Variância (população)" },
  { name: "VARP", en: "VARP", signature: "VARP(núm1; [núm2]; ...)", description: "Variância (população)" },
  { name: "MODO", en: "MODE", signature: "MODO(núm1; [núm2]; ...)", description: "Valor mais frequente" },
  { name: "MODO.ÚNICO", en: "MODE.SNGL", signature: "MODO.ÚNICO(núm1; [núm2]; ...)", description: "Valor mais frequente" },
  { name: "ORDEM", en: "RANK", signature: "ORDEM(núm; ref; [ordem])", description: "Posição do número na lista" },
  { name: "ORDEM.EQ", en: "RANK.EQ", signature: "ORDEM.EQ(núm; ref; [ordem])", description: "Posição do número na lista" },
  { name: "PERCENTIL", en: "PERCENTILE", signature: "PERCENTIL(matriz; k)", description: "k-ésimo percentil (0 a 1)" },
  { name: "PERCENTIL.INC", en: "PERCENTILE.INC", signature: "PERCENTIL.INC(matriz; k)", description: "k-ésimo percentil (0 a 1)" },
  { name: "QUARTIL", en: "QUARTILE", signature: "QUARTIL(matriz; quarto)", description: "Quartil (0 a 4)" },
  { name: "QUARTIL.INC", en: "QUARTILE.INC", signature: "QUARTIL.INC(matriz; quarto)", description: "Quartil (0 a 4)" },
  { name: "SOMAQUAD", en: "SUMSQ", signature: "SOMAQUAD(núm1; [núm2]; ...)", description: "Soma dos quadrados" },
  // Matemáticas
  { name: "TETO", en: "CEILING", signature: "TETO(número; significância)", description: "Arredonda para cima no múltiplo" },
  { name: "TETO.MAT", en: "CEILING.MATH", signature: "TETO.MAT(número; [significância]; [modo])", description: "Arredonda para cima no múltiplo" },
  { name: "ARREDMULTB.MAT", en: "FLOOR.MATH", signature: "ARREDMULTB.MAT(número; [significância]; [modo])", description: "Arredonda para baixo no múltiplo" },
  { name: "MARRED", en: "MROUND", signature: "MARRED(número; múltiplo)", description: "Arredonda para o múltiplo mais próximo" },
  { name: "SINAL", en: "SIGN", signature: "SINAL(número)", description: "1, 0 ou -1" },
  { name: "EXP", en: "EXP", signature: "EXP(número)", description: "e elevado ao número" },
  { name: "LN", en: "LN", signature: "LN(número)", description: "Logaritmo natural" },
  { name: "LOG", en: "LOG", signature: "LOG(número; [base])", description: "Logaritmo (base 10 se omitida)" },
  { name: "LOG10", en: "LOG10", signature: "LOG10(número)", description: "Logaritmo na base 10" },
  { name: "FATORIAL", en: "FACT", signature: "FATORIAL(número)", description: "Fatorial" },
  { name: "MDC", en: "GCD", signature: "MDC(núm1; [núm2]; ...)", description: "Máximo divisor comum" },
  { name: "MMC", en: "LCM", signature: "MMC(núm1; [núm2]; ...)", description: "Mínimo múltiplo comum" },
  { name: "QUOCIENTE", en: "QUOTIENT", signature: "QUOCIENTE(numerador; denominador)", description: "Parte inteira da divisão" },
  { name: "PAR", en: "EVEN", signature: "PAR(número)", description: "Arredonda para o próximo par" },
  { name: "ÍMPAR", en: "ODD", signature: "ÍMPAR(número)", description: "Arredonda para o próximo ímpar" },
  { name: "SEN", en: "SIN", signature: "SEN(número)", description: "Seno (radianos)" },
  { name: "COS", en: "COS", signature: "COS(número)", description: "Cosseno (radianos)" },
  { name: "TAN", en: "TAN", signature: "TAN(número)", description: "Tangente (radianos)" },
  { name: "GRAUS", en: "DEGREES", signature: "GRAUS(ângulo)", description: "Radianos para graus" },
  { name: "RADIANOS", en: "RADIANS", signature: "RADIANOS(ângulo)", description: "Graus para radianos" },
  // Lógicas e informação
  { name: "XOU", en: "XOR", signature: "XOU(lógico1; [lógico2]; ...)", description: "VERDADEIRO se um número ímpar for verdadeiro" },
  { name: "PARÂMETRO", en: "SWITCH", signature: "PARÂMETRO(expressão; valor1; resultado1; ...; [padrão])", description: "Escolhe o resultado pelo valor" },
  { name: "VERDADEIRO", en: "TRUE", signature: "VERDADEIRO()", description: "Valor lógico VERDADEIRO" },
  { name: "FALSO", en: "FALSE", signature: "FALSO()", description: "Valor lógico FALSO" },
  { name: "ÉLÓGICO", en: "ISLOGICAL", signature: "ÉLÓGICO(valor)", description: "VERDADEIRO se for lógico" },
  { name: "ÉNÃOTEXTO", en: "ISNONTEXT", signature: "ÉNÃOTEXTO(valor)", description: "VERDADEIRO se não for texto" },
  { name: "ÉERRO", en: "ISERR", signature: "ÉERRO(valor)", description: "VERDADEIRO se for erro (exceto #N/D)" },
  { name: "É.NÃO.DISP", en: "ISNA", signature: "É.NÃO.DISP(valor)", description: "VERDADEIRO se for #N/D" },
  { name: "TIPO", en: "TYPE", signature: "TIPO(valor)", description: "1 número, 2 texto, 4 lógico, 16 erro, 64 matriz" },
  { name: "N", en: "N", signature: "N(valor)", description: "Converte em número" },
  { name: "T", en: "T", signature: "T(valor)", description: "Texto ou vazio" },
  // Texto
  { name: "EXATO", en: "EXACT", signature: "EXATO(texto1; texto2)", description: "Compara diferenciando maiúsculas" },
  { name: "MUDAR", en: "REPLACE", signature: "MUDAR(texto_antigo; núm_inicial; núm_caract; novo_texto)", description: "Troca parte do texto pela posição" },
  { name: "TEXTOANTES", en: "TEXTBEFORE", signature: "TEXTOANTES(texto; delimitador; [núm_instância])", description: "Texto antes do delimitador" },
  { name: "TEXTODEPOIS", en: "TEXTAFTER", signature: "TEXTODEPOIS(texto; delimitador; [núm_instância])", description: "Texto depois do delimitador" },
  { name: "VALORNUMÉRICO", en: "NUMBERVALUE", signature: "VALORNUMÉRICO(texto; [separador_decimal]; [separador_grupo])", description: "Texto em número com separadores escolhidos" },
  { name: "MOEDA", en: "DOLLAR", signature: "MOEDA(número; [decimais])", description: "Número como texto em R$" },
  { name: "DEF.NÚM.DEC", en: "FIXED", signature: "DEF.NÚM.DEC(número; [decimais]; [sem_separador])", description: "Número como texto com casas fixas" },
  { name: "UNICARACT", en: "UNICHAR", signature: "UNICARACT(número)", description: "Caractere Unicode" },
  { name: "UNICODE", en: "UNICODE", signature: "UNICODE(texto)", description: "Código Unicode do 1º caractere" },
  // Data e hora
  { name: "TEMPO", en: "TIME", signature: "TEMPO(hora; minuto; segundo)", description: "Monta um horário (fração do dia)" },
  { name: "HORA", en: "HOUR", signature: "HORA(núm_série)", description: "Hora (0 a 23)" },
  { name: "MINUTO", en: "MINUTE", signature: "MINUTO(núm_série)", description: "Minuto (0 a 59)" },
  { name: "SEGUNDO", en: "SECOND", signature: "SEGUNDO(núm_série)", description: "Segundo (0 a 59)" },
  { name: "DATA.VALOR", en: "DATEVALUE", signature: "DATA.VALOR(texto_data)", description: "Texto de data em número de série" },
  { name: "VALOR.TEMPO", en: "TIMEVALUE", signature: "VALOR.TEMPO(texto_hora)", description: "Texto de hora em fração do dia" },
  { name: "FRAÇÃOANO", en: "YEARFRAC", signature: "FRAÇÃOANO(data_inicial; data_final; [base])", description: "Fração de ano entre datas" },
  { name: "DIAS360", en: "DAYS360", signature: "DIAS360(data_inicial; data_final; [método])", description: "Dias entre datas no ano de 360 dias" },
  { name: "NÚMSEMANAISO", en: "ISOWEEKNUM", signature: "NÚMSEMANAISO(data)", description: "Semana ISO do ano" },
  // Referência
  { name: "LIN", en: "ROW", signature: "LIN([ref])", description: "Número da linha" },
  { name: "COL", en: "COLUMN", signature: "COL([ref])", description: "Número da coluna" },
  { name: "LINS", en: "ROWS", signature: "LINS(matriz)", description: "Quantidade de linhas" },
  { name: "COLS", en: "COLUMNS", signature: "COLS(matriz)", description: "Quantidade de colunas" },
  { name: "HIPERLINK", en: "HYPERLINK", signature: "HIPERLINK(local_vínculo; [nome_amigável])", description: "Texto do link" },
  { name: "SUBTOTAL", en: "SUBTOTAL", signature: "SUBTOTAL(núm_função; ref1; ...)", description: "Subtotal (9 = soma, 1 = média, 3 = contagem…)" },
  { name: "NÃO.DISP", en: "NA", signature: "NÃO.DISP()", description: "Retorna o erro #N/D" },
];

const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const FN_INDEX = new Map<string, FunctionInfo>();
for (const f of FUNCTIONS) {
  FN_INDEX.set(stripAccents(f.name).toUpperCase(), f);
  FN_INDEX.set(f.en, f);
}
// O Excel já exibiu NÚMSEMANA sem ponto em algumas versões/localidades.
FN_INDEX.set("NUMSEMANA", FN_INDEX.get("NUM.SEMANA")!);
/** Nome digitado (qualquer forma) → função do catálogo. */
export function lookupFunction(name: string): FunctionInfo | undefined {
  const key = stripAccents(name).toUpperCase();
  return FN_INDEX.get(key) ?? FN_INDEX.get(key.replace(/^_XLFN\./, ""));
}

// ─── Tokenizador ─────────────────────────────────────────────────────

/** Referência já resolvida: coluna (índice na tela ou id no interno) + linha relativa/absoluta. */
export type RefSpec = { col: string; colAbs: boolean; row: number; rowAbs: boolean; whole?: boolean };

type Tok =
  | { t: "num"; raw: string; v: number }
  | { t: "str"; raw: string; v: string }
  | { t: "bool"; raw: string; v: boolean }
  | { t: "err"; raw: string; v: ErrCode }
  | { t: "ref"; raw: string; ref: RefSpec }
  | { t: "func"; raw: string; name: string }
  | { t: "op"; raw: string }
  | { t: "("; raw: string }
  | { t: ")"; raw: string }
  | { t: "sep"; raw: string }
  | { t: ":"; raw: string }
  | { t: "ws"; raw: string };

const ERR_LITERALS: ErrCode[] = ["#DIV/0!", "#VALOR!", "#REF!", "#NOME?", "#N/D", "#NÚM!", "#NULO!"];
const INTERNAL_REF = /^⟦(\$?)([^|⟧]+)\|(~-?\d+|\$\d+|\*)⟧/;
const A1_REF = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_.(])/;
const A1_COL = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![A-Za-z0-9_.(])/;
const IDENT = /^[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_.]*/;

export class FormulaSyntaxError extends Error {}

/**
 * Quebra o texto em pedaços. `mode` = "a1" (o que o usuário digita: letras
 * de coluna e número de linha) ou "internal" (o que fica guardado: ⟦id|~n⟧).
 * No modo a1, a referência sai com `col` = índice da coluna e `row` = número
 * da linha (absoluto); quem chama converte.
 */
function tokenize(src: string, mode: "a1" | "internal"): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const ch = src[i];
    if (/\s/.test(ch)) {
      const m = /^\s+/.exec(rest)!;
      out.push({ t: "ws", raw: m[0] });
      i += m[0].length;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let v = "";
      for (;;) {
        if (j >= src.length) throw new FormulaSyntaxError("Aspas não fechadas");
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            v += '"';
            j += 2;
            continue;
          }
          break;
        }
        v += src[j++];
      }
      out.push({ t: "str", raw: src.slice(i, j + 1), v });
      i = j + 1;
      continue;
    }
    if (ch === "#") {
      const lit = ERR_LITERALS.find((e) => rest.toUpperCase().startsWith(e));
      if (!lit) throw new FormulaSyntaxError("Erro desconhecido");
      out.push({ t: "err", raw: rest.slice(0, lit.length), v: lit });
      i += lit.length;
      continue;
    }
    if (mode === "internal" && ch === "⟦") {
      const m = INTERNAL_REF.exec(rest);
      if (!m) throw new FormulaSyntaxError("Referência inválida");
      const spec = m[3];
      const ref: RefSpec =
        spec === "*"
          ? { col: m[2], colAbs: m[1] === "$", row: 0, rowAbs: true, whole: true }
          : spec.startsWith("$")
            ? { col: m[2], colAbs: m[1] === "$", row: Number(spec.slice(1)), rowAbs: true }
            : { col: m[2], colAbs: m[1] === "$", row: Number(spec.slice(1)), rowAbs: false };
      out.push({ t: "ref", raw: m[0], ref });
      i += m[0].length;
      continue;
    }
    if (mode === "a1") {
      const col = A1_COL.exec(rest);
      if (col) {
        // "C:C" vira duas referências de coluna inteira ligadas por ":".
        out.push({ t: "ref", raw: `${col[1]}${col[2]}`, ref: { col: String(letterToIndex(col[2])), colAbs: col[1] === "$", row: 0, rowAbs: true, whole: true } });
        out.push({ t: ":", raw: ":" });
        out.push({ t: "ref", raw: `${col[3]}${col[4]}`, ref: { col: String(letterToIndex(col[4])), colAbs: col[3] === "$", row: 0, rowAbs: true, whole: true } });
        i += col[0].length;
        continue;
      }
      const ref = A1_REF.exec(rest);
      if (ref) {
        out.push({
          t: "ref",
          raw: ref[0],
          ref: { col: String(letterToIndex(ref[2])), colAbs: ref[1] === "$", row: Number(ref[4]), rowAbs: ref[3] === "$" },
        });
        i += ref[0].length;
        continue;
      }
    }
    if (/\d/.test(ch) || (ch === "." && /\d/.test(src[i + 1] ?? ""))) {
      // Número com vírgula ou ponto decimal: como no Excel em português, o separador de argumentos é ";".
      const raw = /^\d*(?:[.,]\d+)?(?:[eE][+-]?\d+)?/.exec(rest)![0];
      out.push({ t: "num", raw, v: Number(raw.replace(",", ".")) });
      i += raw.length;
      continue;
    }
    const id = IDENT.exec(rest);
    if (id) {
      const after = src.slice(i + id[0].length);
      const upper = stripAccents(id[0]).toUpperCase();
      if (/^\s*\(/.test(after)) {
        out.push({ t: "func", raw: id[0], name: id[0] });
        i += id[0].length;
        continue;
      }
      if (upper === "VERDADEIRO" || upper === "TRUE" || upper === "FALSO" || upper === "FALSE") {
        out.push({ t: "bool", raw: id[0], v: upper === "VERDADEIRO" || upper === "TRUE" });
        i += id[0].length;
        continue;
      }
      throw new FormulaSyntaxError(`Nome desconhecido: ${id[0]}`);
    }
    const two = rest.slice(0, 2);
    if (two === "<>" || two === "<=" || two === ">=") {
      out.push({ t: "op", raw: two });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>%".includes(ch)) {
      out.push({ t: "op", raw: ch });
      i++;
      continue;
    }
    if (ch === "(") out.push({ t: "(", raw: ch });
    else if (ch === ")") out.push({ t: ")", raw: ch });
    else if (ch === ";" || ch === ",") out.push({ t: "sep", raw: ch });
    else if (ch === ":") out.push({ t: ":", raw: ch });
    else throw new FormulaSyntaxError(`Caractere inesperado: ${ch}`);
    i++;
  }
  return out;
}

// ─── Conversão tela (A1) ↔ guardado (interno) ↔ Excel (inglês) ──────

export type FormulaColumn = { id: string; name: string; type: SheetColumnType };

export type CompileResult = { ok: true; internal: string } | { ok: false; error: string };

/**
 * Texto digitado na célula (=A2*B2) → texto guardado. `ownRow` = número da
 * linha da própria célula (linha 1 = cabeçalho). Valida a sintaxe inteira
 * (parse) para nunca guardar fórmula quebrada.
 */
export function compileFormula(text: string, ownRow: number, columns: FormulaColumn[]): CompileResult {
  const body = text.trim();
  if (!body.startsWith("=")) return { ok: false, error: "Fórmula precisa começar com =" };
  if (body.length > MAX_FORMULA_CHARS) return { ok: false, error: "Fórmula longa demais" };
  try {
    const toks = tokenize(body.slice(1), "a1");
    let out = "";
    for (const tok of toks) {
      if (tok.t === "ref") {
        const idx = Number(tok.ref.col);
        const col = columns[idx];
        if (!col) return { ok: false, error: `A coluna ${indexToLetter(idx)} não existe` };
        const rowSpec = tok.ref.whole ? "*" : tok.ref.rowAbs ? `$${tok.ref.row}` : `~${tok.ref.row - ownRow}`;
        out += `⟦${tok.ref.colAbs ? "$" : ""}${col.id}|${rowSpec}⟧`;
      } else if (tok.t === "func") {
        const fn = lookupFunction(tok.name);
        if (!fn) return { ok: false, error: `Função desconhecida: ${tok.name}` };
        out += fn.name;
      } else if (tok.t === "sep") out += ";";
      else out += tok.raw;
    }
    parse(tokenize(out, "internal"));
    return { ok: true, internal: `=${out}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Fórmula inválida" };
  }
}

/**
 * Texto guardado → texto para mostrar/editar (A1, português) ou para o
 * .xlsx (`english`: nomes em inglês, vírgula como separador, ponto decimal).
 */
export function displayFormula(internal: string, ownRow: number, columns: FormulaColumn[], opts: { english?: boolean } = {}): string {
  const body = internal.startsWith("=") ? internal.slice(1) : internal;
  let toks: Tok[];
  try {
    toks = tokenize(body, "internal");
  } catch {
    return internal;
  }
  const colIdx = new Map(columns.map((c, i) => [c.id, i]));
  let out = "";
  for (const tok of toks) {
    if (tok.t === "ref") {
      const idx = colIdx.get(tok.ref.col);
      if (idx === undefined) {
        out += "#REF!";
        continue;
      }
      const letters = `${tok.ref.colAbs ? "$" : ""}${indexToLetter(idx)}`;
      if (tok.ref.whole) out += letters;
      else {
        const row = tok.ref.rowAbs ? tok.ref.row : ownRow + tok.ref.row;
        out += row < 1 ? "#REF!" : `${letters}${tok.ref.rowAbs ? "$" : ""}${row}`;
      }
    } else if (tok.t === "func") {
      const fn = lookupFunction(tok.name);
      out += opts.english ? (fn?.en ?? tok.name) : (fn?.name ?? tok.name);
    } else if (tok.t === "sep") out += opts.english ? "," : ";";
    else if (tok.t === "num" && opts.english) out += tok.raw.replace(",", ".");
    else if (tok.t === "bool" && opts.english) out += tok.v ? "TRUE" : "FALSE";
    else if (tok.t === "err" && opts.english) out += { "#VALOR!": "#VALUE!", "#NOME?": "#NAME?", "#N/D": "#N/A", "#NÚM!": "#NUM!" }[tok.v as string] ?? tok.v;
    else if (tok.t === "str" && opts.english) out += tok.raw;
    else out += tok.raw;
  }
  return `=${out}`;
}

/** Ids das colunas citadas na fórmula (para avisar quem depende de quem). */
export function referencedColumns(internal: string): string[] {
  try {
    return [...new Set(tokenize(internal.replace(/^=/, ""), "internal").flatMap((t) => (t.t === "ref" ? [t.ref.col] : [])))];
  } catch {
    return [];
  }
}

// ─── Parser (precedência do Excel) ───────────────────────────────────

type Node =
  | { k: "lit"; v: Scalar }
  | { k: "ref"; ref: RefSpec }
  | { k: "range"; a: RefSpec; b: RefSpec }
  | { k: "un"; op: "-" | "+"; x: Node }
  | { k: "pct"; x: Node }
  | { k: "bin"; op: string; l: Node; r: Node }
  | { k: "call"; fn: FunctionInfo; args: Node[] };

function parse(all: Tok[]): Node {
  const toks = all.filter((t) => t.t !== "ws");
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expectOp = (raw: string) => {
    const t = next();
    if (!t || t.raw !== raw) throw new FormulaSyntaxError(`Esperava "${raw}"`);
  };

  // comparação < concatenação & < soma < multiplicação < potência < % < unário < primário
  const levels: string[][] = [["=", "<>", "<", ">", "<=", ">="], ["&"], ["+", "-"], ["*", "/"], ["^"]];
  function binary(level: number): Node {
    if (level === levels.length) return postfix();
    let left = binary(level + 1);
    for (;;) {
      const t = peek();
      if (t && t.t === "op" && levels[level].includes(t.raw)) {
        next();
        left = { k: "bin", op: t.raw, l: left, r: binary(level + 1) };
      } else return left;
    }
  }
  function postfix(): Node {
    let x = unary();
    while (peek()?.t === "op" && peek()!.raw === "%") {
      next();
      x = { k: "pct", x };
    }
    return x;
  }
  function unary(): Node {
    const t = peek();
    if (t && t.t === "op" && (t.raw === "-" || t.raw === "+")) {
      next();
      return { k: "un", op: t.raw as "-" | "+", x: unary() };
    }
    return primary();
  }
  function primary(): Node {
    const t = next();
    if (!t) throw new FormulaSyntaxError("Fórmula incompleta");
    switch (t.t) {
      case "num":
        return { k: "lit", v: t.v };
      case "str":
        return { k: "lit", v: t.v };
      case "bool":
        return { k: "lit", v: t.v };
      case "err":
        return { k: "lit", v: new FormulaError(t.v) };
      case "ref": {
        if (peek()?.t === ":") {
          next();
          const b = next();
          if (!b || b.t !== "ref") throw new FormulaSyntaxError("Intervalo inválido");
          return { k: "range", a: t.ref, b: b.ref };
        }
        if (t.ref.whole) throw new FormulaSyntaxError("Use coluna inteira como C:C");
        return { k: "ref", ref: t.ref };
      }
      case "func": {
        const fn = lookupFunction(t.name);
        if (!fn) throw new FormulaSyntaxError(`Função desconhecida: ${t.name}`);
        expectOp("(");
        const args: Node[] = [];
        if (peek()?.t !== ")") {
          for (;;) {
            // Argumento vazio (SE(A1;;0)) = vazio.
            if (peek()?.t === "sep" || peek()?.t === ")") args.push({ k: "lit", v: null });
            else args.push(binary(0));
            if (peek()?.t === "sep") {
              next();
              continue;
            }
            break;
          }
        }
        expectOp(")");
        return { k: "call", fn, args };
      }
      case "(": {
        const inner = binary(0);
        expectOp(")");
        return inner;
      }
      default:
        throw new FormulaSyntaxError(`"${t.raw}" fora de lugar`);
    }
  }
  const root = binary(0);
  if (p < toks.length) throw new FormulaSyntaxError(`"${toks[p].raw}" fora de lugar`);
  return root;
}

const astCache = new Map<string, Node | FormulaSyntaxError>();
function parseCached(internal: string): Node | FormulaSyntaxError {
  let hit = astCache.get(internal);
  if (!hit) {
    try {
      hit = parse(tokenize(internal.replace(/^=/, ""), "internal"));
    } catch (err) {
      hit = err instanceof FormulaSyntaxError ? err : new FormulaSyntaxError("Fórmula inválida");
    }
    if (astCache.size > 5000) astCache.clear();
    astCache.set(internal, hit);
  }
  return hit;
}

// ─── Conversões de tipo (regras do Excel) ────────────────────────────

/**
 * Número em texto como o Excel faz (=1/3&""): 15 dígitos significativos (a
 * precisão que ele guarda), vírgula decimal, sem separador de milhar e sem
 * notação científica até 1e15.
 */
export function generalNumber(n: number): string {
  if (!Number.isFinite(n)) return "#NÚM!";
  if (n === 0) return "0";
  const r = Number(n.toPrecision(15));
  const abs = Math.abs(r);
  let text = String(r);
  if (abs >= 1e-9 && abs < 1e15) {
    const fixed = r.toFixed(Math.max(0, 14 - Math.floor(Math.log10(abs))));
    // Só corta zeros da parte decimal (100000000000000 não pode virar "1").
    text = fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
  }
  return text.replace(".", ",");
}

function toNum(v: Scalar): number | FormulaError {
  if (isErr(v)) return v;
  if (v === null || v === "") return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  const d = parseLooseDate(v);
  if (d && /[/-]/.test(v)) return isoToSerial(d);
  const n = parseLooseNumber(v);
  return n === null ? ERR.value() : n;
}
function toText(v: Scalar): string | FormulaError {
  if (isErr(v)) return v;
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "VERDADEIRO" : "FALSO";
  if (typeof v === "number") return generalNumber(v);
  return v;
}
function toBool(v: Scalar): boolean | FormulaError {
  if (isErr(v)) return v;
  if (typeof v === "boolean") return v;
  if (v === null) return false;
  if (typeof v === "number") return v !== 0;
  const u = stripAccents(v).toUpperCase();
  if (u === "VERDADEIRO" || u === "TRUE") return true;
  if (u === "FALSO" || u === "FALSE") return false;
  return ERR.value();
}
/** Ordem de comparação do Excel: números < textos < lógicos; texto sem diferenciar maiúsculas. */
function compare(a: Scalar, b: Scalar): number {
  const rank = (v: Scalar) => (typeof v === "number" || v === null ? 0 : typeof v === "string" ? 1 : 2);
  const na = a === null ? (typeof b === "string" ? "" : 0) : a;
  const nb = b === null ? (typeof a === "string" ? "" : 0) : b;
  const ra = rank(na as Scalar);
  const rb = rank(nb as Scalar);
  if (ra !== rb) return ra - rb;
  if (typeof na === "number" && typeof nb === "number") return na - nb;
  if (typeof na === "string" && typeof nb === "string") return na.localeCompare(nb, "pt-BR", { sensitivity: "base" });
  return Number(na) - Number(nb);
}

function wildcardRegex(pattern: string) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "~" && i + 1 < pattern.length) re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (c === "*") re += ".*";
    else if (c === "?") re += ".";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

/** Critério de SOMASE/CONT.SE: ">10", "<>x", "=texto", "abc*", ou um valor. */
function criterion(crit: Scalar): (v: Scalar) => boolean {
  if (typeof crit !== "string") return (v) => !isErr(v) && v !== null && compare(v, crit) === 0;
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(crit)!;
  const op = m[1] ?? "=";
  const rhsText = m[2];
  const rhsNum = rhsText.trim() === "" ? null : parseLooseNumber(rhsText);
  const rhsDate = parseLooseDate(rhsText);
  const rhs: Scalar = rhsDate && /\//.test(rhsText) ? isoToSerial(rhsDate) : rhsNum !== null ? rhsNum : rhsText;
  const isWild = typeof rhs === "string" && /[*?]/.test(rhs);
  return (v) => {
    if (isErr(v)) return false;
    if (op === "=" || op === "<>") {
      let eq: boolean;
      if (rhsText === "") eq = v === null || v === "";
      else if (isWild) eq = typeof v === "string" && wildcardRegex(rhs as string).test(v);
      else if (typeof rhs === "number") eq = (typeof v === "number" && v === rhs) || (typeof v === "string" && parseLooseNumber(v) === rhs);
      else eq = typeof v === "string" && v.localeCompare(rhs as string, "pt-BR", { sensitivity: "base" }) === 0;
      return op === "=" ? eq : !eq;
    }
    if (v === null || typeof v === "boolean") return false;
    if (typeof rhs === "number" && typeof v !== "number") return false;
    if (typeof rhs === "string" && typeof v !== "string") return false;
    const c = compare(v, rhs);
    return op === "<" ? c < 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : c >= 0;
  };
}

// ─── TEXTO(valor; formato) ───────────────────────────────────────────

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

function formatText(value: number, fmt: string): string {
  if (/[dmay]/i.test(fmt.replace(/"[^"]*"/g, "")) && !/[0#]/.test(fmt)) {
    const { y, m, d, wd } = serialParts(value);
    const frac = value - Math.floor(value);
    const hh = Math.floor(frac * 24);
    const mi = Math.round((frac * 24 - hh) * 60);
    // Trechos literais do formato ("de" entre aspas ou \d) ficam como estão, igual ao Excel.
    const literals: string[] = [];
    const masked = fmt.replace(/"([^"]*)"|\\(.)/g, (_m: string, q?: string, e?: string) => {
      literals.push(q ?? e ?? "");
      return `\uE000${literals.length - 1}\uE001`;
    });
    return masked.replace(/aaaa|yyyy|aa|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss/gi, (tok) => {
      const t = tok.toLowerCase();
      if (t === "aaaa" || t === "yyyy") return String(y);
      if (t === "aa" || t === "yy") return String(y).slice(-2);
      if (t === "mmmm") return MONTHS[m - 1];
      if (t === "mmm") return MONTHS[m - 1].slice(0, 3);
      if (t === "mm") return /h/i.test(fmt) && /:/.test(fmt) && fmt.toLowerCase().indexOf("mm") > fmt.toLowerCase().indexOf("h") ? String(mi).padStart(2, "0") : String(m).padStart(2, "0");
      if (t === "m") return String(m);
      if (t === "dddd") return WEEKDAYS[wd];
      if (t === "ddd") return WEEKDAYS[wd].slice(0, 3);
      if (t === "dd") return String(d).padStart(2, "0");
      if (t === "d") return String(d);
      if (t === "hh") return String(hh).padStart(2, "0");
      if (t === "h") return String(hh);
      return "00";
    }).replace(/\uE000(\d+)\uE001/g, (_m, i: string) => literals[Number(i)]);
  }
  const m = /^([^0#]*)([#0.,]+)(%?)(.*)$/.exec(fmt);
  if (!m) return generalNumber(value);
  const [, prefix, pattern, pct, suffix] = m;
  const decimals = pattern.includes(",") ? pattern.split(",")[1].length : 0;
  const grouping = pattern.split(",")[0].includes(".");
  const n = pct ? value * 100 : value;
  const s = n.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouping });
  return `${prefix}${s}${pct}${suffix}`;
}

// ─── Avaliação ───────────────────────────────────────────────────────

export type EvalContext = {
  /** Colunas na ordem da tela (A, B, C…). */
  columns: FormulaColumn[];
  /** Quantidade de linhas de dados (a linha 1 é o cabeçalho). */
  dataRows: number;
  /** Valor de uma célula: linha 1 = nome da coluna; dados a partir da 2. */
  cell: (colIndex: number, row: number) => Scalar;
  today?: number;
  now?: number;
};

type Resolved = { c1: number; c2: number; r1: number; r2: number } | FormulaError;

function resolveRef(ref: RefSpec, ownRow: number, ctx: EvalContext): { c: number; r: number } | FormulaError {
  const c = ctx.columns.findIndex((col) => col.id === ref.col);
  if (c < 0) return ERR.ref();
  const r = ref.rowAbs ? ref.row : ownRow + ref.row;
  if (r < 1) return ERR.ref();
  return { c, r };
}

function resolveRange(a: RefSpec, b: RefSpec, ownRow: number, ctx: EvalContext): Resolved {
  if (a.whole || b.whole) {
    const ca = ctx.columns.findIndex((col) => col.id === a.col);
    const cb = ctx.columns.findIndex((col) => col.id === b.col);
    if (ca < 0 || cb < 0) return ERR.ref();
    // Coluna inteira = só os dados (sem o cabeçalho, para SOMA(C:C) não tropeçar no nome).
    return { c1: Math.min(ca, cb), c2: Math.max(ca, cb), r1: 2, r2: Math.max(2, ctx.dataRows + 1) };
  }
  const pa = resolveRef(a, ownRow, ctx);
  const pb = resolveRef(b, ownRow, ctx);
  if (isErr(pa)) return pa;
  if (isErr(pb)) return pb;
  return { c1: Math.min(pa.c, pb.c), c2: Math.max(pa.c, pb.c), r1: Math.min(pa.r, pb.r), r2: Math.max(pa.r, pb.r) };
}

/** Avalia uma fórmula guardada (interna) para a célula da linha `ownRow`. */
export function evaluateFormula(internal: string, ownRow: number, ctx: EvalContext): Scalar {
  const ast = parseCached(internal);
  if (ast instanceof FormulaSyntaxError) return ERR.name();
  let v = evalNode(ast, ownRow, ctx);
  if (isMatrix(v)) v = v[0]?.[0] ?? null; // intervalo num lugar de valor: Excel pega o canto
  // =B5 com B5 vazia mostra 0 no Excel.
  return v === null ? 0 : v;
}

function evalNode(n: Node, ownRow: number, ctx: EvalContext): Val {
  switch (n.k) {
    case "lit":
      return n.v;
    case "ref": {
      const p = resolveRef(n.ref, ownRow, ctx);
      if (isErr(p)) return p;
      return ctx.cell(p.c, p.r);
    }
    case "range": {
      const r = resolveRange(n.a, n.b, ownRow, ctx);
      if (isErr(r)) return r;
      const out: Matrix = [];
      for (let row = r.r1; row <= r.r2; row++) {
        const line: Scalar[] = [];
        for (let c = r.c1; c <= r.c2; c++) line.push(ctx.cell(c, row));
        out.push(line);
      }
      return out;
    }
    case "un": {
      const x = scalarOf(evalNode(n.x, ownRow, ctx));
      const num = toNum(x);
      if (isErr(num)) return num;
      return n.op === "-" ? -num : num;
    }
    case "pct": {
      const num = toNum(scalarOf(evalNode(n.x, ownRow, ctx)));
      return isErr(num) ? num : num / 100;
    }
    case "bin": {
      const l = scalarOf(evalNode(n.l, ownRow, ctx));
      const r = scalarOf(evalNode(n.r, ownRow, ctx));
      if (isErr(l)) return l;
      if (isErr(r)) return r;
      if (n.op === "&") {
        const a = toText(l);
        const b = toText(r);
        return isErr(a) ? a : isErr(b) ? b : a + b;
      }
      if (["=", "<>", "<", ">", "<=", ">="].includes(n.op)) {
        const c = compare(l, r);
        return n.op === "=" ? c === 0 : n.op === "<>" ? c !== 0 : n.op === "<" ? c < 0 : n.op === ">" ? c > 0 : n.op === "<=" ? c <= 0 : c >= 0;
      }
      const a = toNum(l);
      const b = toNum(r);
      if (isErr(a)) return a;
      if (isErr(b)) return b;
      switch (n.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return b === 0 ? ERR.div() : a / b;
        case "^": {
          const p = Math.pow(a, b);
          return Number.isFinite(p) ? p : ERR.num();
        }
      }
      return ERR.value();
    }
    case "call":
      return callFunction(n.fn.name, n.args, ownRow, ctx);
  }
}

function scalarOf(v: Val): Scalar {
  return isMatrix(v) ? (v[0]?.[0] ?? null) : v;
}

/** Valores "achatados" de argumentos (intervalos viram listas). `fromRange` = veio de intervalo (Excel ignora texto/lógico nas agregações). */
function flatten(vals: Val[]): { v: Scalar; fromRange: boolean }[] {
  const out: { v: Scalar; fromRange: boolean }[] = [];
  for (const v of vals) {
    if (isMatrix(v)) for (const line of v) for (const s of line) out.push({ v: s, fromRange: true });
    else out.push({ v, fromRange: false });
  }
  return out;
}

/** Números para SOMA/MÉDIA…: de intervalo, só números; argumento direto, converte (texto numérico vale). */
function numbersOf(vals: Val[]): number[] | FormulaError {
  const out: number[] = [];
  for (const { v, fromRange } of flatten(vals)) {
    if (isErr(v)) return v;
    if (fromRange) {
      if (typeof v === "number") out.push(v);
    } else if (v !== null) {
      const n = toNum(v);
      if (isErr(n)) return n;
      out.push(n);
    }
  }
  return out;
}

const asMatrix = (v: Val): Matrix => (isMatrix(v) ? v : [[v]]);

function lookupExact(needle: Scalar, hay: Scalar[]): number {
  if (typeof needle === "string" && /[*?]/.test(needle)) {
    const re = wildcardRegex(needle);
    return hay.findIndex((h) => typeof h === "string" && re.test(h));
  }
  return hay.findIndex((h) => h !== null && !isErr(h) && compare(h, needle) === 0 && typeof h === typeof needle) >= 0
    ? hay.findIndex((h) => h !== null && !isErr(h) && compare(h, needle) === 0 && typeof h === typeof needle)
    : hay.findIndex((h) => h !== null && !isErr(h) && compare(h, needle) === 0);
}
/** Aproximada (dados em ordem crescente): última posição <= valor. */
function lookupApprox(needle: Scalar, hay: Scalar[]): number {
  let found = -1;
  for (let i = 0; i < hay.length; i++) {
    const h = hay[i];
    if (h === null || isErr(h)) continue;
    if (compare(h, needle) <= 0) found = i;
    else break;
  }
  return found;
}

function roundTo(n: number, digits: number, mode: "round" | "up" | "down") {
  const f = Math.pow(10, digits);
  const x = Math.abs(n) * f;
  const r = mode === "round" ? Math.round(x + 1e-9) : mode === "up" ? Math.ceil(x - 1e-9) : Math.floor(x + 1e-9);
  return (Math.sign(n) * r) / f;
}

function sameShape(a: Matrix, b: Matrix) {
  return a.length === b.length && a.every((line, i) => line.length === (b[i]?.length ?? -1));
}

const WINDOWS_1252: Record<number, string> = {
  128: "€", 130: "‚", 131: "ƒ", 132: "„", 133: "…", 134: "†", 135: "‡", 136: "ˆ", 137: "‰", 138: "Š", 139: "‹",
  140: "Œ", 142: "Ž", 145: "‘", 146: "’", 147: "“", 148: "”", 149: "•", 150: "–", 151: "—", 152: "˜", 153: "™",
  154: "š", 155: "›", 156: "œ", 158: "ž", 159: "Ÿ",
};
const WINDOWS_1252_REVERSE = new Map(Object.entries(WINDOWS_1252).map(([code, char]) => [char, Number(code)]));

function weekNumber(serial: number, returnType: number): number | FormulaError {
  const whole = Math.floor(serial);
  const p = serialParts(whole);
  if (returnType === 21) {
    const date = new Date(Date.UTC(p.y, p.m - 1, p.d));
    const day = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() + 3 - day);
    const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    first.setUTCDate(first.getUTCDate() + 3 - ((first.getUTCDay() + 6) % 7));
    return 1 + Math.round((date.getTime() - first.getTime()) / (7 * DAY));
  }
  const firstDayByType: Record<number, number> = { 1: 0, 2: 1, 11: 1, 12: 2, 13: 3, 14: 4, 15: 5, 16: 6, 17: 0 };
  const firstDay = firstDayByType[returnType];
  if (firstDay === undefined) return ERR.num();
  const jan1 = partsToSerial(p.y, 1, 1);
  const offset = (serialParts(jan1).wd - firstDay + 7) % 7;
  return Math.floor((whole - jan1 + offset) / 7) + 1;
}

/** Tira ruído de ponto flutuante (0,1+0,2) em arredondamentos de múltiplos. */
function cleanFloat(n: number) {
  return Math.round(n * 1e12) / 1e12;
}

// Financeiras — mesmas fórmulas fechadas da documentação pública (tipo 1 = parcela no início).
function finPmt(rate: number, n: number, pv: number, fv: number, type: number): number {
  if (n === 0) return Number.NaN;
  if (rate === 0) return -(pv + fv) / n;
  const f = Math.pow(1 + rate, n);
  return (-(fv + pv * f) * rate) / ((1 + rate * type) * (f - 1));
}
function finPv(rate: number, n: number, pmt: number, fv: number, type: number): number {
  if (rate === 0) return -(fv + pmt * n);
  const f = Math.pow(1 + rate, n);
  return -(fv + (pmt * (1 + rate * type) * (f - 1)) / rate) / f;
}
function finFv(rate: number, n: number, pmt: number, pv: number, type: number): number {
  if (rate === 0) return -(pv + pmt * n);
  const f = Math.pow(1 + rate, n);
  return -(pv * f + (pmt * (1 + rate * type) * (f - 1)) / rate);
}

/** DIAS360: método americano (NASD) ou europeu. */
function days360(a: number, b: number, european: boolean) {
  const pa = serialParts(a);
  const pb = serialParts(b);
  let d1 = pa.d;
  let d2 = pb.d;
  if (european) {
    if (d1 === 31) d1 = 30;
    if (d2 === 31) d2 = 30;
  } else {
    const lastFeb = (p: { y: number; m: number; d: number }) => p.m === 2 && p.d === new Date(Date.UTC(p.y, 2, 0)).getUTCDate();
    if (lastFeb(pa)) {
      if (lastFeb(pb)) d2 = 30;
      d1 = 30;
    }
    if (d1 === 31) d1 = 30;
    if (d2 === 31 && d1 >= 30) d2 = 30;
  }
  return (pb.y - pa.y) * 360 + (pb.m - pa.m) * 30 + (d2 - d1);
}

function callFunction(name: string, args: Node[], ownRow: number, ctx: EvalContext): Val {
  const ev = (i: number): Val => (i < args.length ? evalNode(args[i], ownRow, ctx) : null);
  const sc = (i: number): Scalar => scalarOf(ev(i));
  const all = () => args.map((a) => evalNode(a, ownRow, ctx));
  const need = (min: number, max = Infinity) => args.length >= min && args.length <= max;
  const num = (i: number, dflt?: number): number | FormulaError => (i >= args.length && dflt !== undefined ? dflt : toNum(sc(i)));
  const txt = (i: number): string | FormulaError => toText(sc(i));
  const dateOf = (i: number) => num(i);
  const today = ctx.today ?? todaySerial();

  switch (name) {
    case "SOMA": {
      const ns = numbersOf(all());
      return isErr(ns) ? ns : ns.reduce((a, b) => a + b, 0);
    }
    case "PRODUTO": {
      const ns = numbersOf(all());
      return isErr(ns) ? ns : ns.length ? ns.reduce((a, b) => a * b, 1) : 0;
    }
    case "SOMARPRODUTO": {
      if (!need(1, 255)) return ERR.value();
      const matrices = all().map(asMatrix);
      if (matrices.some((matrix) => !sameShape(matrix, matrices[0]))) return ERR.value();
      let total = 0;
      for (let r = 0; r < matrices[0].length; r++) {
        for (let c = 0; c < matrices[0][r].length; c++) {
          let product = 1;
          for (const matrix of matrices) {
            const value = matrix[r][c];
            if (isErr(value)) return value;
            product *= typeof value === "number" ? value : 0;
          }
          total += product;
        }
      }
      return total;
    }
    case "MÉDIA": {
      const ns = numbersOf(all());
      if (isErr(ns)) return ns;
      return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : ERR.div();
    }
    case "MÍNIMO":
    case "MÁXIMO": {
      const ns = numbersOf(all());
      if (isErr(ns)) return ns;
      return ns.length ? (name === "MÍNIMO" ? Math.min(...ns) : Math.max(...ns)) : 0;
    }
    case "MED": {
      const ns = numbersOf(all());
      if (isErr(ns)) return ns;
      if (!ns.length) return ERR.num();
      const s = [...ns].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }
    case "MAIOR":
    case "MENOR": {
      if (!need(2, 2)) return ERR.value();
      const ns = numbersOf([ev(0)]);
      const k = num(1);
      if (isErr(ns)) return ns;
      if (isErr(k)) return k;
      const s = [...ns].sort((a, b) => (name === "MAIOR" ? b - a : a - b));
      return k >= 1 && k <= s.length ? s[Math.floor(k) - 1] : ERR.num();
    }
    case "CONT.NÚM":
      return flatten(all()).filter(({ v, fromRange }) => typeof v === "number" || (!fromRange && v !== null && !isErr(toNum(v)) && typeof v !== "boolean")).length;
    case "CONT.VALORES":
      return flatten(all()).filter(({ v }) => v !== null && v !== "").length;
    case "CONTAR.VAZIO":
      return flatten(all()).filter(({ v }) => v === null || v === "").length;
    case "SE": {
      if (!need(1, 3)) return ERR.value();
      const t = toBool(sc(0));
      if (isErr(t)) return t;
      if (t) return args.length >= 2 ? ev(1) : true;
      return args.length >= 3 ? ev(2) : false;
    }
    case "SES": {
      if (args.length < 2 || args.length % 2) return ERR.value();
      for (let i = 0; i < args.length; i += 2) {
        const t = toBool(sc(i));
        if (isErr(t)) return t;
        if (t) return ev(i + 1);
      }
      return ERR.na();
    }
    case "E":
    case "OU": {
      const vs = flatten(all()).filter(({ v, fromRange }) => !(fromRange && (v === null || typeof v === "string")));
      if (!vs.length) return ERR.value();
      let acc = name === "E";
      for (const { v } of vs) {
        const b = toBool(v);
        if (isErr(b)) return b;
        acc = name === "E" ? acc && b : acc || b;
      }
      return acc;
    }
    case "NÃO": {
      const b = toBool(sc(0));
      return isErr(b) ? b : !b;
    }
    case "SEERRO": {
      const v = sc(0);
      return isErr(v) ? sc(1) : v;
    }
    case "SENÃODISP": {
      const v = sc(0);
      return isErr(v) && v.code === "#N/D" ? sc(1) : v;
    }
    case "ÉCÉL.VAZIA":
      return sc(0) === null;
    case "ÉNÚM":
      return typeof sc(0) === "number";
    case "ÉTEXTO":
      return typeof sc(0) === "string";
    case "ÉERROS":
      return isErr(sc(0));
    case "ÉPAR":
    case "ÉIMPAR": {
      if (!need(1, 1)) return ERR.value();
      const n = num(0);
      if (isErr(n)) return n;
      const odd = Math.abs(Math.trunc(n)) % 2 === 1;
      return name === "ÉIMPAR" ? odd : !odd;
    }
    case "SOMASE":
    case "MÉDIASE": {
      if (!need(2, 3)) return ERR.value();
      const range = asMatrix(ev(0)).flat();
      const target = args.length === 3 ? asMatrix(ev(2)).flat() : range;
      const test = criterion(sc(1));
      let sum = 0;
      let count = 0;
      range.forEach((v, i) => {
        const t = target[i];
        if (test(v) && typeof t === "number") {
          sum += t;
          count++;
        }
      });
      if (name === "SOMASE") return sum;
      return count ? sum / count : ERR.div();
    }
    case "SOMASES":
    case "CONT.SES": {
      const start = name === "SOMASES" ? 1 : 0;
      if (args.length < start + 2 || (args.length - start) % 2) return ERR.value();
      const sumRange = name === "SOMASES" ? asMatrix(ev(0)).flat() : null;
      const pairs: { range: Scalar[]; test: (v: Scalar) => boolean }[] = [];
      for (let i = start; i < args.length; i += 2) pairs.push({ range: asMatrix(ev(i)).flat(), test: criterion(sc(i + 1)) });
      const size = sumRange?.length ?? pairs[0].range.length;
      if (pairs.some((p) => p.range.length !== size)) return ERR.value();
      let sum = 0;
      let count = 0;
      for (let i = 0; i < size; i++) {
        if (pairs.every((p) => p.test(p.range[i]))) {
          count++;
          const t = sumRange?.[i];
          if (typeof t === "number") sum += t;
        }
      }
      return name === "SOMASES" ? sum : count;
    }
    case "MÉDIASES":
    case "MÁXIMOSES":
    case "MÍNIMOSES": {
      if (args.length < 3 || args.length % 2 === 0) return ERR.value();
      const targetMatrix = asMatrix(ev(0));
      const target = targetMatrix.flat();
      const pairs: { values: Scalar[]; test: (v: Scalar) => boolean }[] = [];
      for (let i = 1; i < args.length; i += 2) {
        const matrix = asMatrix(ev(i));
        if (!sameShape(matrix, targetMatrix)) return ERR.value();
        pairs.push({ values: matrix.flat(), test: criterion(sc(i + 1)) });
      }
      const found = target.filter((value, index) => typeof value === "number" && pairs.every((pair) => pair.test(pair.values[index]))) as number[];
      if (name === "MÉDIASES") return found.length ? found.reduce((sum, value) => sum + value, 0) / found.length : ERR.div();
      if (!found.length) return 0;
      return name === "MÁXIMOSES" ? Math.max(...found) : Math.min(...found);
    }
    case "CONT.SE": {
      if (!need(2, 2)) return ERR.value();
      const test = criterion(sc(1));
      return asMatrix(ev(0)).flat().filter(test).length;
    }
    case "PROCV":
    case "PROCH": {
      if (!need(3, 4)) return ERR.value();
      const needle = sc(0);
      if (isErr(needle)) return needle;
      let table = asMatrix(ev(1));
      if (name === "PROCH") table = table[0]?.map((_, c) => table.map((line) => line[c])) ?? [];
      const idx = num(2);
      if (isErr(idx)) return idx;
      const approx = args.length < 4 ? true : toBool(sc(3));
      if (isErr(approx)) return approx;
      if (idx < 1 || idx > (table[0]?.length ?? 0)) return ERR.ref();
      const firstCol = table.map((line) => line[0]);
      const pos = approx ? lookupApprox(needle, firstCol) : lookupExact(needle, firstCol);
      return pos < 0 ? ERR.na() : (table[pos][Math.floor(idx) - 1] ?? null);
    }
    case "PROCX": {
      if (!need(3, 4)) return ERR.value();
      const needle = sc(0);
      const hay = asMatrix(ev(1)).flat();
      const ret = asMatrix(ev(2)).flat();
      const pos = lookupExact(needle, hay);
      if (pos < 0) return args.length === 4 ? sc(3) : ERR.na();
      return ret[pos] ?? null;
    }
    case "ÍNDICE": {
      if (!need(2, 3)) return ERR.value();
      const m = asMatrix(ev(0));
      const r = num(1);
      const c = num(2, 1);
      if (isErr(r)) return r;
      if (isErr(c)) return c;
      // Matriz de uma linha só: ÍNDICE(A1:D1; 3) pega a 3ª coluna (igual ao Excel).
      if (m.length === 1 && args.length === 2) return m[0][Math.floor(r) - 1] ?? ERR.ref();
      return m[Math.floor(r) - 1]?.[Math.floor(c) - 1] ?? ERR.ref();
    }
    case "CORRESP": {
      if (!need(2, 3)) return ERR.value();
      const needle = sc(0);
      const hay = asMatrix(ev(1)).flat();
      const type = num(2, 1);
      if (isErr(type)) return type;
      const pos = type === 0 ? lookupExact(needle, hay) : lookupApprox(needle, hay);
      return pos < 0 ? ERR.na() : pos + 1;
    }
    case "CORRESPX": {
      if (!need(2, 4)) return ERR.value();
      const needle = sc(0);
      if (isErr(needle)) return needle;
      const hay = asMatrix(ev(1)).flat();
      const matchMode = num(2, 0);
      const searchMode = num(3, 1);
      if (isErr(matchMode)) return matchMode;
      if (isErr(searchMode)) return searchMode;
      if (![0, -1, 1, 2].includes(matchMode) || ![1, -1, 2, -2].includes(searchMode)) return ERR.value();
      const order = Array.from({ length: hay.length }, (_, i) => (searchMode < 0 ? hay.length - 1 - i : i));
      let pos = -1;
      if (matchMode === 2) {
        if (typeof needle !== "string") return ERR.value();
        const re = wildcardRegex(needle);
        pos = order.find((i) => typeof hay[i] === "string" && re.test(hay[i] as string)) ?? -1;
      } else {
        pos = order.find((i) => hay[i] !== null && !isErr(hay[i]) && compare(hay[i], needle) === 0) ?? -1;
        if (pos < 0 && matchMode !== 0) {
          const candidates = order.filter((i) => hay[i] !== null && !isErr(hay[i]) && (matchMode === -1 ? compare(hay[i], needle) < 0 : compare(hay[i], needle) > 0));
          if (candidates.length) pos = candidates.reduce((best, i) => (matchMode === -1 ? compare(hay[i], hay[best]) > 0 : compare(hay[i], hay[best]) < 0) ? i : best);
        }
      }
      return pos < 0 ? ERR.na() : pos + 1;
    }
    case "ESCOLHER": {
      if (!need(2, 255)) return ERR.value();
      const index = num(0);
      if (isErr(index)) return index;
      const at = Math.trunc(index);
      return at < 1 || at >= args.length ? ERR.value() : ev(at);
    }
    case "ARRED":
    case "ARREDONDAR.PARA.CIMA":
    case "ARREDONDAR.PARA.BAIXO": {
      const n = num(0);
      const d = num(1, 0);
      if (isErr(n)) return n;
      if (isErr(d)) return d;
      return roundTo(n, Math.trunc(d), name === "ARRED" ? "round" : name === "ARREDONDAR.PARA.CIMA" ? "up" : "down");
    }
    case "ARREDMULTB": {
      if (!need(2, 2)) return ERR.value();
      const n = num(0);
      const multiple = num(1);
      if (isErr(n)) return n;
      if (isErr(multiple)) return multiple;
      if (multiple === 0) return 0;
      if (n !== 0 && Math.sign(n) !== Math.sign(multiple)) return ERR.num();
      const step = Math.abs(multiple);
      return Math.sign(n) * Math.round(Math.abs(n) / step + 1e-12) * step;
    }
    case "TRUNCAR": {
      if (!need(1, 2)) return ERR.value();
      const n = num(0);
      const digits = num(1, 0);
      if (isErr(n)) return n;
      if (isErr(digits)) return digits;
      const factor = Math.pow(10, Math.trunc(digits));
      return Math.trunc(n * factor) / factor;
    }
    case "INT": {
      const n = num(0);
      return isErr(n) ? n : Math.floor(n);
    }
    case "ABS": {
      const n = num(0);
      return isErr(n) ? n : Math.abs(n);
    }
    case "MOD": {
      const n = num(0);
      const d = num(1);
      if (isErr(n)) return n;
      if (isErr(d)) return d;
      if (d === 0) return ERR.div();
      return n - d * Math.floor(n / d);
    }
    case "POTÊNCIA": {
      const a = num(0);
      const b = num(1);
      if (isErr(a)) return a;
      if (isErr(b)) return b;
      const p = Math.pow(a, b);
      return Number.isFinite(p) ? p : ERR.num();
    }
    case "RAIZ": {
      const n = num(0);
      if (isErr(n)) return n;
      return n < 0 ? ERR.num() : Math.sqrt(n);
    }
    case "PI":
      return Math.PI;
    case "CONCAT":
    case "CONCATENAR": {
      let s = "";
      for (const { v } of flatten(all())) {
        const t = toText(v);
        if (isErr(t)) return t;
        s += t;
      }
      return s;
    }
    case "UNIRTEXTO": {
      if (args.length < 3) return ERR.value();
      const sep = txt(0);
      const skip = toBool(sc(1));
      if (isErr(sep)) return sep;
      if (isErr(skip)) return skip;
      const parts: string[] = [];
      for (const { v } of flatten(args.slice(2).map((a) => evalNode(a, ownRow, ctx)))) {
        const t = toText(v);
        if (isErr(t)) return t;
        if (!(skip && t === "")) parts.push(t);
      }
      return parts.join(sep);
    }
    case "ESQUERDA":
    case "DIREITA": {
      const t = txt(0);
      const n = num(1, 1);
      if (isErr(t)) return t;
      if (isErr(n)) return n;
      if (n < 0) return ERR.value();
      return name === "ESQUERDA" ? t.slice(0, n) : n === 0 ? "" : t.slice(-n);
    }
    case "EXT.TEXTO": {
      const t = txt(0);
      const s = num(1);
      const n = num(2);
      if (isErr(t)) return t;
      if (isErr(s)) return s;
      if (isErr(n)) return n;
      if (s < 1 || n < 0) return ERR.value();
      return t.substr(s - 1, n);
    }
    case "NÚM.CARACT": {
      const t = txt(0);
      return isErr(t) ? t : t.length;
    }
    case "MAIÚSCULA":
    case "MINÚSCULA":
    case "PRI.MAIÚSCULA":
    case "ARRUMAR": {
      const t = txt(0);
      if (isErr(t)) return t;
      if (name === "MAIÚSCULA") return t.toLocaleUpperCase("pt-BR");
      if (name === "MINÚSCULA") return t.toLocaleLowerCase("pt-BR");
      if (name === "ARRUMAR") return t.trim().replace(/ +/g, " ");
      return t.toLocaleLowerCase("pt-BR").replace(/(^|[^A-Za-zÀ-ÿ])([A-Za-zÀ-ÿ])/g, (_, a: string, b: string) => a + b.toLocaleUpperCase("pt-BR"));
    }
    case "SUBSTITUIR": {
      const t = txt(0);
      const from = txt(1);
      const to = txt(2);
      if (isErr(t)) return t;
      if (isErr(from)) return from;
      if (isErr(to)) return to;
      if (!from) return t;
      if (args.length < 4) return t.split(from).join(to);
      const nth = num(3);
      if (isErr(nth)) return nth;
      let count = 0;
      return t.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), (m) => (++count === nth ? to : m));
    }
    case "LOCALIZAR":
    case "PROCURAR": {
      const needle = txt(0);
      const hay = txt(1);
      const start = num(2, 1);
      if (isErr(needle)) return needle;
      if (isErr(hay)) return hay;
      if (isErr(start)) return start;
      const idx = name === "LOCALIZAR" ? hay.toLowerCase().indexOf(needle.toLowerCase(), start - 1) : hay.indexOf(needle, start - 1);
      return idx < 0 ? ERR.value() : idx + 1;
    }
    case "TEXTO": {
      const v = sc(0);
      const f = txt(1);
      if (isErr(f)) return f;
      const n = toNum(v);
      if (isErr(n)) return typeof v === "string" ? v : n;
      return formatText(n, f);
    }
    case "VALOR": {
      const v = sc(0);
      if (typeof v === "number") return v;
      const n = toNum(v);
      return isErr(n) ? ERR.value() : n;
    }
    case "REPT": {
      if (!need(2, 2)) return ERR.value();
      const value = txt(0);
      const count = num(1);
      if (isErr(value)) return value;
      if (isErr(count)) return count;
      const times = Math.trunc(count);
      if (times < 0 || value.length * times > 32767) return ERR.value();
      return value.repeat(times);
    }
    case "TIRAR": {
      if (!need(1, 1)) return ERR.value();
      const value = txt(0);
      return isErr(value) ? value : value.replace(/[\u0000-\u001F]/g, "");
    }
    case "CARACT": {
      if (!need(1, 1)) return ERR.value();
      const code = num(0);
      if (isErr(code)) return code;
      const byte = Math.trunc(code);
      if (byte < 1 || byte > 255) return ERR.value();
      return WINDOWS_1252[byte] ?? String.fromCharCode(byte);
    }
    case "CÓDIGO": {
      if (!need(1, 1)) return ERR.value();
      const value = txt(0);
      if (isErr(value)) return value;
      if (!value) return ERR.value();
      return WINDOWS_1252_REVERSE.get(value[0]) ?? value.charCodeAt(0);
    }
    case "NÃO.DISP":
      return need(0, 0) ? ERR.na() : ERR.value();
    case "HOJE":
      return today;
    case "AGORA": {
      const c = brazilClock(new Date(ctx.now ?? Date.now()));
      return today + (c.h * 3600 + c.mi * 60 + c.s) / 86400;
    }
    case "DATA": {
      const y = num(0);
      const m = num(1);
      const d = num(2);
      if (isErr(y)) return y;
      if (isErr(m)) return m;
      if (isErr(d)) return d;
      const serial = Math.round((Date.UTC(y < 1900 ? y + 1900 : y, m - 1, d) - EPOCH) / DAY);
      return serial < 0 ? ERR.num() : serial;
    }
    case "ANO":
    case "MÊS":
    case "DIA": {
      const s = dateOf(0);
      if (isErr(s)) return s;
      const p = serialParts(s);
      return name === "ANO" ? p.y : name === "MÊS" ? p.m : p.d;
    }
    case "DIAS": {
      const a = dateOf(0);
      const b = dateOf(1);
      if (isErr(a)) return a;
      if (isErr(b)) return b;
      return Math.floor(a) - Math.floor(b);
    }
    case "DATADIF": {
      const a = dateOf(0);
      const b = dateOf(1);
      const unit = txt(2);
      if (isErr(a)) return a;
      if (isErr(b)) return b;
      if (isErr(unit)) return unit;
      if (a > b) return ERR.num();
      const pa = serialParts(a);
      const pb = serialParts(b);
      let months = (pb.y - pa.y) * 12 + (pb.m - pa.m);
      if (pb.d < pa.d) months--;
      switch (unit.toUpperCase()) {
        case "D":
          return Math.floor(b) - Math.floor(a);
        case "M":
          return months;
        case "A":
        case "Y":
          return Math.floor(months / 12);
        case "YM":
        case "AM":
          return months % 12;
        case "MD": {
          const d = pb.d - pa.d;
          return d >= 0 ? d : new Date(Date.UTC(pb.y, pb.m - 1, 0)).getUTCDate() + d;
        }
        default:
          return ERR.num();
      }
    }
    case "DIATRABALHOTOTAL": {
      const a = dateOf(0);
      const b = dateOf(1);
      if (isErr(a)) return a;
      if (isErr(b)) return b;
      const holidays = new Set(args.length > 2 ? (numbersOf([ev(2)]) as number[]).map(Math.floor) : []);
      const [lo, hi] = a <= b ? [Math.floor(a), Math.floor(b)] : [Math.floor(b), Math.floor(a)];
      let count = 0;
      for (let s = lo; s <= hi; s++) {
        const wd = serialParts(s).wd;
        if (wd !== 0 && wd !== 6 && !holidays.has(s)) count++;
      }
      return a <= b ? count : -count;
    }
    case "DIATRABALHO": {
      if (!need(2, 3)) return ERR.value();
      const start = dateOf(0);
      const days = num(1);
      if (isErr(start)) return start;
      if (isErr(days)) return days;
      const holidayValues = args.length > 2 ? numbersOf([ev(2)]) : [];
      if (isErr(holidayValues)) return holidayValues;
      const holidays = new Set(holidayValues.map(Math.floor));
      let current = Math.floor(start);
      let remaining = Math.abs(Math.trunc(days));
      const direction = days < 0 ? -1 : 1;
      while (remaining > 0) {
        current += direction;
        const wd = serialParts(current).wd;
        if (wd !== 0 && wd !== 6 && !holidays.has(current)) remaining--;
      }
      return current;
    }
    case "NÚM.SEMANA": {
      if (!need(1, 2)) return ERR.value();
      const serial = dateOf(0);
      const returnType = num(1, 1);
      if (isErr(serial)) return serial;
      if (isErr(returnType)) return returnType;
      return weekNumber(serial, Math.trunc(returnType));
    }
    case "DIA.DA.SEMANA": {
      const s = dateOf(0);
      const type = num(1, 1);
      if (isErr(s)) return s;
      if (isErr(type)) return type;
      const wd = serialParts(s).wd;
      if (type === 1) return wd + 1;
      if (type === 2) return wd === 0 ? 7 : wd;
      if (type === 3) return wd === 0 ? 6 : wd - 1;
      return ERR.num();
    }
    case "FIMMÊS":
    case "DATAM": {
      const s = dateOf(0);
      const m = num(1);
      if (isErr(s)) return s;
      if (isErr(m)) return m;
      const p = serialParts(s);
      const target = new Date(Date.UTC(p.y, p.m - 1 + Math.trunc(m), 1));
      const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
      const day = name === "FIMMÊS" ? lastDay : Math.min(p.d, lastDay);
      return partsToSerial(target.getUTCFullYear(), target.getUTCMonth() + 1, day);
    }
    // ── Financeiras (fórmulas da documentação pública; sinais como no Excel) ──
    case "PGTO":
    case "VP":
    case "VF":
    case "NPER": {
      if (!need(3, 5)) return ERR.value();
      const a = num(0);
      const b = num(1);
      const c = num(2);
      const d = num(3, 0);
      const t = num(4, 0);
      for (const v of [a, b, c, d, t]) if (isErr(v)) return v;
      const [x, y, z, w, type] = [a, b, c, d, t] as number[];
      const tp = type ? 1 : 0;
      if (name === "PGTO") return finPmt(x, y, z, w, tp);
      if (name === "VP") return finPv(x, y, z, w, tp);
      if (name === "VF") return finFv(x, y, z, w, tp);
      // NPER(taxa; pgto; vp; vf; tipo)
      if (x === 0) return y === 0 ? ERR.num() : -(z + w) / y;
      const num1 = y * (1 + x * tp) - w * x;
      const den = y * (1 + x * tp) + z * x;
      if (num1 / den <= 0) return ERR.num();
      return Math.log(num1 / den) / Math.log(1 + x);
    }
    case "TAXA": {
      if (!need(3, 6)) return ERR.value();
      const vals = [num(0), num(1), num(2), num(3, 0), num(4, 0), num(5, 0.1)];
      for (const v of vals) if (isErr(v)) return v;
      const [n, pmt, pv, fv, type, guess] = vals as number[];
      const tp = type ? 1 : 0;
      // Newton-Raphson, como o Excel (até 100 iterações; sem convergência = #NÚM!).
      const f = (r: number) => (Math.abs(r) < 1e-12 ? pv + pmt * n + fv : pv * Math.pow(1 + r, n) + (pmt * (1 + r * tp) * (Math.pow(1 + r, n) - 1)) / r + fv);
      let r = guess;
      for (let i = 0; i < 100; i++) {
        const fr = f(r);
        const h = 1e-7;
        const d = (f(r + h) - fr) / h;
        if (!Number.isFinite(d) || d === 0) break;
        const next = r - fr / d;
        if (!Number.isFinite(next)) break;
        if (Math.abs(next - r) < 1e-12) return next;
        r = next;
      }
      return Math.abs(f(r)) < 1e-6 ? r : ERR.num();
    }
    case "IPGTO":
    case "PPGTO": {
      if (!need(4, 6)) return ERR.value();
      const vals = [num(0), num(1), num(2), num(3), num(4, 0), num(5, 0)];
      for (const v of vals) if (isErr(v)) return v;
      const [rate, per, n, pv, fv, type] = vals as number[];
      const tp = type ? 1 : 0;
      if (per < 1 || per > n) return ERR.num();
      const pmt = finPmt(rate, n, pv, fv, tp);
      let ipmt = tp === 1 && per === 1 ? 0 : finFv(rate, per - 1, pmt, pv, tp) * rate;
      if (tp === 1 && per > 1) ipmt /= 1 + rate;
      return name === "IPGTO" ? ipmt : pmt - ipmt;
    }
    case "VPL": {
      if (args.length < 2) return ERR.value();
      const rate = num(0);
      if (isErr(rate)) return rate;
      const ns = numbersOf(args.slice(1).map((a) => evalNode(a, ownRow, ctx)));
      if (isErr(ns)) return ns;
      return ns.reduce((acc, v, i) => acc + v / Math.pow(1 + rate, i + 1), 0);
    }
    case "TIR": {
      if (!need(1, 2)) return ERR.value();
      const ns = numbersOf([ev(0)]);
      const guess = num(1, 0.1);
      if (isErr(ns)) return ns;
      if (isErr(guess)) return guess;
      if (!ns.some((v) => v > 0) || !ns.some((v) => v < 0)) return ERR.num();
      const npv = (r: number) => ns.reduce((acc, v, i) => acc + v / Math.pow(1 + r, i), 0);
      let r = guess;
      for (let i = 0; i < 100; i++) {
        const fr = npv(r);
        const d = (npv(r + 1e-7) - fr) / 1e-7;
        if (!Number.isFinite(d) || d === 0) break;
        const next = r - fr / d;
        if (Math.abs(next - r) < 1e-12) return next;
        r = next;
      }
      return Math.abs(npv(r)) < 1e-6 ? r : ERR.num();
    }
    // ── Estatísticas ──
    case "DESVPAD.A":
    case "DESVPAD":
    case "DESVPAD.P":
    case "DESVPADP":
    case "VAR.A":
    case "VAR":
    case "VAR.P":
    case "VARP": {
      const ns = numbersOf(all());
      if (isErr(ns)) return ns;
      const pop = name === "DESVPAD.P" || name === "DESVPADP" || name === "VAR.P" || name === "VARP";
      if (ns.length < (pop ? 1 : 2)) return ERR.div();
      const mean = ns.reduce((a, b) => a + b, 0) / ns.length;
      const variance = ns.reduce((a, b) => a + (b - mean) ** 2, 0) / (ns.length - (pop ? 0 : 1));
      return name.startsWith("VAR") ? variance : Math.sqrt(variance);
    }
    case "MODO":
    case "MODO.ÚNICO": {
      const ns = numbersOf(all());
      if (isErr(ns)) return ns;
      const counts = new Map<number, number>();
      let best: number | null = null;
      let bestCount = 1;
      for (const v of ns) {
        const c = (counts.get(v) ?? 0) + 1;
        counts.set(v, c);
        if (c > bestCount) {
          best = v;
          bestCount = c;
        }
      }
      // Empate: o Excel devolve o que aparece primeiro na lista.
      if (best !== null) for (const v of ns) if (counts.get(v) === bestCount) return v;
      return ERR.na();
    }
    case "ORDEM":
    case "ORDEM.EQ": {
      if (!need(2, 3)) return ERR.value();
      const n = num(0);
      const order = num(2, 0);
      const ns = numbersOf([ev(1)]);
      if (isErr(n)) return n;
      if (isErr(order)) return order;
      if (isErr(ns)) return ns;
      if (!ns.includes(n)) return ERR.na();
      return 1 + ns.filter((v) => (order ? v < n : v > n)).length;
    }
    case "PERCENTIL":
    case "PERCENTIL.INC":
    case "QUARTIL":
    case "QUARTIL.INC": {
      if (!need(2, 2)) return ERR.value();
      const ns = numbersOf([ev(0)]);
      const kRaw = num(1);
      if (isErr(ns)) return ns;
      if (isErr(kRaw)) return kRaw;
      const k = name.startsWith("QUARTIL") ? Math.trunc(kRaw) / 4 : kRaw;
      if (!ns.length || k < 0 || k > 1 || (name.startsWith("QUARTIL") && (kRaw < 0 || kRaw > 4))) return ERR.num();
      const sorted = [...ns].sort((a, b) => a - b);
      const pos = k * (sorted.length - 1);
      const lo = Math.floor(pos);
      return sorted[lo] + (pos - lo) * ((sorted[lo + 1] ?? sorted[lo]) - sorted[lo]);
    }
    case "SOMAQUAD": {
      const ns = numbersOf(all());
      return isErr(ns) ? ns : ns.reduce((a, b) => a + b * b, 0);
    }
    // ── Matemáticas ──
    case "TETO":
    case "TETO.MAT":
    case "ARREDMULTB.MAT": {
      const n = num(0);
      const sigDefault = name === "TETO" ? undefined : 1;
      if (name === "TETO" && args.length < 2) return ERR.value();
      const sRaw = num(1, sigDefault);
      const mode = num(2, 0);
      if (isErr(n)) return n;
      if (isErr(sRaw)) return sRaw;
      if (isErr(mode)) return mode;
      if (sRaw === 0 || n === 0) return 0;
      if (name === "TETO") {
        if (n > 0 && sRaw < 0) return ERR.num();
        return cleanFloat(Math.ceil(n / sRaw - 1e-12) * sRaw);
      }
      const s0 = Math.abs(sRaw);
      // .MAT: negativo arredonda em direção a zero (TETO) ou para longe (ARREDMULTB), salvo `modo`.
      if (name === "TETO.MAT") return cleanFloat(n < 0 && mode ? Math.floor(n / s0 + 1e-12) * s0 : Math.ceil(n / s0 - 1e-12) * s0);
      return cleanFloat(n < 0 && mode ? Math.ceil(n / s0 - 1e-12) * s0 : Math.floor(n / s0 + 1e-12) * s0);
    }
    case "MARRED": {
      const n = num(0);
      const m = num(1);
      if (isErr(n)) return n;
      if (isErr(m)) return m;
      if (m === 0) return 0;
      if (Math.sign(n) * Math.sign(m) < 0) return ERR.num();
      return cleanFloat(Math.sign(n) * Math.round(Math.abs(n / m) + 1e-12) * Math.abs(m));
    }
    case "SINAL": {
      const n = num(0);
      return isErr(n) ? n : Math.sign(n);
    }
    case "EXP":
    case "LN":
    case "LOG10":
    case "SEN":
    case "COS":
    case "TAN":
    case "GRAUS":
    case "RADIANOS": {
      const n = num(0);
      if (isErr(n)) return n;
      if ((name === "LN" || name === "LOG10") && n <= 0) return ERR.num();
      const fns: Record<string, (x: number) => number> = {
        EXP: Math.exp,
        LN: Math.log,
        LOG10: Math.log10,
        SEN: Math.sin,
        COS: Math.cos,
        TAN: Math.tan,
        GRAUS: (x) => (x * 180) / Math.PI,
        RADIANOS: (x) => (x * Math.PI) / 180,
      };
      const out = fns[name](n);
      return Number.isFinite(out) ? out : ERR.num();
    }
    case "LOG": {
      const n = num(0);
      const base = num(1, 10);
      if (isErr(n)) return n;
      if (isErr(base)) return base;
      if (n <= 0 || base <= 0 || base === 1) return n <= 0 || base <= 0 ? ERR.num() : ERR.div();
      return Math.log(n) / Math.log(base);
    }
    case "FATORIAL": {
      const n = num(0);
      if (isErr(n)) return n;
      const k = Math.trunc(n);
      if (k < 0 || k > 170) return ERR.num();
      let f = 1;
      for (let i = 2; i <= k; i++) f *= i;
      return f;
    }
    case "MDC":
    case "MMC": {
      const ns = numbersOf(all());
      if (isErr(ns)) return ns;
      if (!ns.length || ns.some((v) => v < 0)) return ERR.num();
      const ints = ns.map(Math.trunc);
      const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
      if (name === "MDC") return ints.reduce((a, b) => gcd(a, b));
      if (ints.includes(0)) return 0;
      return ints.reduce((a, b) => (a / gcd(a, b)) * b);
    }
    case "QUOCIENTE": {
      const a = num(0);
      const b = num(1);
      if (isErr(a)) return a;
      if (isErr(b)) return b;
      return b === 0 ? ERR.div() : Math.trunc(a / b);
    }
    case "PAR":
    case "ÍMPAR": {
      const n = num(0);
      if (isErr(n)) return n;
      const sign = n < 0 ? -1 : 1;
      let v = Math.ceil(Math.abs(n) - 1e-12);
      if (name === "PAR" && v % 2 !== 0) v++;
      if (name === "ÍMPAR" && v % 2 === 0) v++;
      return sign * v;
    }
    // ── Lógicas e informação ──
    case "XOU": {
      const vs = flatten(all()).filter(({ v, fromRange }) => !(fromRange && (v === null || typeof v === "string")));
      if (!vs.length) return ERR.value();
      let count = 0;
      for (const { v } of vs) {
        const b = toBool(v);
        if (isErr(b)) return b;
        if (b) count++;
      }
      return count % 2 === 1;
    }
    case "PARÂMETRO": {
      if (args.length < 3) return ERR.value();
      const target = sc(0);
      if (isErr(target)) return target;
      const pairs = args.length - 1;
      for (let i = 1; i + 1 < args.length; i += 2) {
        const v = sc(i);
        if (!isErr(v) && v !== null && compare(v, target) === 0 && typeof v === typeof target) return ev(i + 1);
      }
      return pairs % 2 === 1 ? ev(args.length - 1) : ERR.na();
    }
    case "VERDADEIRO":
      return true;
    case "FALSO":
      return false;
    case "ÉLÓGICO":
      return typeof sc(0) === "boolean";
    case "ÉNÃOTEXTO":
      return typeof sc(0) !== "string";
    case "ÉERRO": {
      const v = sc(0);
      return isErr(v) && v.code !== "#N/D";
    }
    case "É.NÃO.DISP": {
      const v = sc(0);
      return isErr(v) && v.code === "#N/D";
    }
    case "TIPO": {
      const raw = ev(0);
      if (isMatrix(raw) && (raw.length > 1 || (raw[0]?.length ?? 0) > 1)) return 64;
      const v = scalarOf(raw);
      return isErr(v) ? 16 : typeof v === "boolean" ? 4 : typeof v === "string" ? 2 : 1;
    }
    case "N": {
      const v = sc(0);
      if (isErr(v)) return v;
      return typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : 0;
    }
    case "T": {
      const v = sc(0);
      if (isErr(v)) return v;
      return typeof v === "string" ? v : "";
    }
    // ── Texto ──
    case "EXATO": {
      const a = txt(0);
      const b = txt(1);
      if (isErr(a)) return a;
      if (isErr(b)) return b;
      return a === b;
    }
    case "MUDAR": {
      if (!need(4, 4)) return ERR.value();
      const t = txt(0);
      const start = num(1);
      const count = num(2);
      const repl = txt(3);
      for (const v of [t, start, count, repl]) if (isErr(v)) return v;
      if ((start as number) < 1 || (count as number) < 0) return ERR.value();
      const st = Math.trunc(start as number) - 1;
      return (t as string).slice(0, st) + (repl as string) + (t as string).slice(st + Math.trunc(count as number));
    }
    case "TEXTOANTES":
    case "TEXTODEPOIS": {
      if (!need(2, 3)) return ERR.value();
      const t = txt(0);
      const delim = txt(1);
      const inst = num(2, 1);
      for (const v of [t, delim, inst]) if (isErr(v)) return v;
      const text = t as string;
      const d = delim as string;
      const k = Math.trunc(inst as number);
      if (k === 0 || !d) return ERR.value();
      const positions: number[] = [];
      for (let i = text.indexOf(d); i >= 0; i = text.indexOf(d, i + d.length)) positions.push(i);
      const pos = k > 0 ? positions[k - 1] : positions[positions.length + k];
      if (pos === undefined) return ERR.na();
      return name === "TEXTOANTES" ? text.slice(0, pos) : text.slice(pos + d.length);
    }
    case "VALORNUMÉRICO": {
      const t = txt(0);
      const dec = args.length > 1 ? txt(1) : ",";
      const grp = args.length > 2 ? txt(2) : ".";
      for (const v of [t, dec, grp]) if (isErr(v)) return v;
      let clean = (t as string).replace(/\s/g, "");
      if (grp) clean = clean.split((grp as string)[0]).join("");
      if (dec) clean = clean.replace((dec as string)[0], ".");
      const pct = (clean.match(/%/g) ?? []).length;
      clean = clean.replace(/%/g, "");
      if (clean === "") return 0;
      const n = Number(clean);
      return Number.isFinite(n) ? n / Math.pow(100, pct) : ERR.value();
    }
    case "MOEDA":
    case "DEF.NÚM.DEC": {
      const n = num(0);
      const d = num(1, 2);
      if (isErr(n)) return n;
      if (isErr(d)) return d;
      const noSep = name === "DEF.NÚM.DEC" && args.length > 2 ? toBool(sc(2)) : false;
      if (isErr(noSep)) return noSep;
      const digits = Math.trunc(d);
      const rounded = roundTo(n, digits, "round");
      const f = Math.max(0, Math.min(digits, 20));
      const body = Math.abs(rounded).toLocaleString("pt-BR", { minimumFractionDigits: f, maximumFractionDigits: f, useGrouping: !noSep });
      if (name === "DEF.NÚM.DEC") return (rounded < 0 ? "-" : "") + body;
      return rounded < 0 ? `-R$ ${body}` : `R$ ${body}`;
    }
    case "UNICARACT": {
      const n = num(0);
      if (isErr(n)) return n;
      const code = Math.trunc(n);
      if (code < 1 || code > 0x10ffff) return ERR.value();
      return String.fromCodePoint(code);
    }
    case "UNICODE": {
      const t = txt(0);
      if (isErr(t)) return t;
      return t ? t.codePointAt(0)! : ERR.value();
    }
    // ── Data e hora ──
    case "TEMPO": {
      const h = num(0);
      const m = num(1);
      const sec = num(2);
      for (const v of [h, m, sec]) if (isErr(v)) return v;
      const total = Math.trunc(h as number) * 3600 + Math.trunc(m as number) * 60 + Math.trunc(sec as number);
      if (total < 0) return ERR.num();
      return (total % 86400) / 86400;
    }
    case "HORA":
    case "MINUTO":
    case "SEGUNDO": {
      const v = num(0);
      if (isErr(v)) return v;
      if (v < 0) return ERR.num();
      const secs = Math.round((v - Math.floor(v)) * 86400) % 86400;
      return name === "HORA" ? Math.floor(secs / 3600) : name === "MINUTO" ? Math.floor((secs % 3600) / 60) : secs % 60;
    }
    case "DATA.VALOR": {
      const t = txt(0);
      if (isErr(t)) return t;
      const iso = parseLooseDate(t);
      return iso ? isoToSerial(iso) : ERR.value();
    }
    case "VALOR.TEMPO": {
      const t = txt(0);
      if (isErr(t)) return t;
      const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(t);
      if (!m) return ERR.value();
      let h = Number(m[1]);
      if (m[4]) h = (h % 12) + (m[4].toUpperCase() === "PM" ? 12 : 0);
      const secs = h * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
      return secs >= 86400 ? ERR.value() : secs / 86400;
    }
    case "DIAS360": {
      const a = num(0);
      const b = num(1);
      if (isErr(a)) return a;
      if (isErr(b)) return b;
      const eu = args.length > 2 ? toBool(sc(2)) : false;
      if (isErr(eu)) return eu;
      return days360(a, b, eu);
    }
    case "FRAÇÃOANO": {
      const a = num(0);
      const b = num(1);
      const basis = num(2, 0);
      for (const v of [a, b, basis]) if (isErr(v)) return v;
      const [lo, hi] = (a as number) <= (b as number) ? [Math.floor(a as number), Math.floor(b as number)] : [Math.floor(b as number), Math.floor(a as number)];
      switch (Math.trunc(basis as number)) {
        case 0:
          return days360(lo, hi, false) / 360;
        case 1: {
          const ya = serialParts(lo).y;
          const yb = serialParts(hi).y;
          let days = 0;
          for (let y = ya; y <= yb; y++) days += partsToSerial(y + 1, 1, 1) - partsToSerial(y, 1, 1);
          return (hi - lo) / (days / (yb - ya + 1));
        }
        case 2:
          return (hi - lo) / 360;
        case 3:
          return (hi - lo) / 365;
        case 4:
          return days360(lo, hi, true) / 360;
        default:
          return ERR.num();
      }
    }
    case "NÚMSEMANAISO": {
      const v = num(0);
      if (isErr(v)) return v;
      const { y, m, d } = serialParts(v);
      const dt = new Date(Date.UTC(y, m - 1, d));
      const day = dt.getUTCDay() || 7;
      dt.setUTCDate(dt.getUTCDate() + 4 - day);
      const yearStart = Date.UTC(dt.getUTCFullYear(), 0, 1);
      return Math.ceil(((dt.getTime() - yearStart) / DAY + 1) / 7);
    }
    // ── Referência ──
    case "LIN":
    case "COL": {
      if (!args.length) return name === "LIN" ? ownRow : ERR.value();
      const a = args[0];
      if (a.k === "ref") {
        const p = resolveRef(a.ref, ownRow, ctx);
        return isErr(p) ? p : name === "LIN" ? p.r : p.c + 1;
      }
      if (a.k === "range") {
        const r = resolveRange(a.a, a.b, ownRow, ctx);
        return isErr(r) ? r : name === "LIN" ? r.r1 : r.c1 + 1;
      }
      return ERR.value();
    }
    case "LINS":
    case "COLS": {
      const a = args[0];
      if (a?.k === "range") {
        const r = resolveRange(a.a, a.b, ownRow, ctx);
        return isErr(r) ? r : name === "LINS" ? r.r2 - r.r1 + 1 : r.c2 - r.c1 + 1;
      }
      if (a?.k === "ref") return 1;
      const m = asMatrix(ev(0));
      return name === "LINS" ? m.length : (m[0]?.length ?? 0);
    }
    case "HIPERLINK": {
      const link = txt(0);
      if (isErr(link)) return link;
      if (args.length > 1) return sc(1);
      return link;
    }
    case "SUBTOTAL": {
      const code = num(0);
      if (isErr(code)) return code;
      const map: Record<number, string> = {
        1: "MÉDIA",
        2: "CONT.NÚM",
        3: "CONT.VALORES",
        4: "MÁXIMO",
        5: "MÍNIMO",
        6: "PRODUTO",
        7: "DESVPAD.A",
        8: "DESVPAD.P",
        9: "SOMA",
        10: "VAR.A",
        11: "VAR.P",
        12: "MED",
      };
      const fn = map[Math.trunc(code) % 100];
      return fn ? callFunction(fn, args.slice(1), ownRow, ctx) : ERR.value();
    }
  }
  return ERR.name();
}

// ─── Planilha inteira: valor guardado ↔ valor da fórmula ─────────────

/** Valor guardado de uma célula → valor visto pela fórmula (como o Excel enxerga). */
export function storedToScalar(type: SheetColumnType, v: CellValue | undefined, refs: Record<string, string>): Scalar {
  if (v === undefined || v === null) return null;
  switch (type) {
    case "NUMBER":
    case "CURRENCY":
      return v as number;
    case "PERCENT":
      return (v as number) / 100; // 12,5% é 0,125 para o Excel
    case "DATE":
      return isoToSerial(String(v));
    case "CHECKBOX":
      return !!v;
    case "MULTI_SELECT":
      return (v as string[]).join(", ");
    case "USER":
    case "CONTACT":
    case "DEAL":
      return Array.isArray(v) ? v.map((id) => refs[id] ?? "").join(", ") : (refs[String(v)] ?? "");
    default:
      return String(v);
  }
}

/**
 * Resultado da fórmula → valor a guardar na coluna (para filtrar, somar,
 * exportar). `undefined` com `display` = não cabe no tipo da coluna (ex.:
 * texto numa coluna de Moeda): a célula mostra o resultado, mas guarda vazio.
 */
export function scalarToStored(type: SheetColumnType, v: Scalar): { value: CellValue | undefined; display?: string; error?: boolean } {
  if (isErr(v)) return { value: undefined, display: v.code, error: true };
  if (v === null) return { value: type === "NUMBER" || type === "CURRENCY" || type === "PERCENT" ? 0 : undefined };
  switch (type) {
    case "NUMBER":
    case "CURRENCY":
    case "PERCENT": {
      const n = typeof v === "number" ? v : typeof v === "boolean" ? null : parseLooseNumber(v);
      if (n === null || !Number.isFinite(n)) return { value: undefined, display: typeof v === "boolean" ? (v ? "VERDADEIRO" : "FALSO") : String(v) };
      const stored = type === "PERCENT" ? n * 100 : n;
      return { value: Math.round(stored * 1e10) / 1e10 };
    }
    case "DATE": {
      if (typeof v === "number" && v >= 0 && v < 2_958_466) return { value: serialToIso(v) };
      if (typeof v === "string") {
        const d = parseLooseDate(v);
        if (d) return { value: d };
      }
      return { value: undefined, display: String(v) };
    }
    case "CHECKBOX":
      return typeof v === "boolean" ? { value: v } : typeof v === "number" ? { value: v !== 0 } : { value: undefined, display: String(v) };
    case "TEXT":
    case "LONG_TEXT": {
      const t = typeof v === "number" ? generalNumber(v) : typeof v === "boolean" ? (v ? "VERDADEIRO" : "FALSO") : v;
      return { value: t === "" ? undefined : t.slice(0, type === "TEXT" ? 1000 : 10000) };
    }
    default: {
      const t = typeof v === "number" ? generalNumber(v) : String(v);
      return { value: undefined, display: t };
    }
  }
}

/** Tipos que não aceitam fórmula (são escolhas de lista ou vínculos com o CRM). */
export const NO_FORMULA_TYPES = new Set<SheetColumnType>(["SELECT", "MULTI_SELECT", "USER", "CONTACT", "DEAL"]);

export type SheetForCalc = {
  columns: FormulaColumn[];
  /** Linhas na ordem real da planilha (posição) — linha i = linha i + 2 do Excel. */
  rows: { id: string; values: Record<string, CellValue>; formulas?: Record<string, string> }[];
  refs: Record<string, string>;
  today?: number;
};

export type CalcResult = {
  /** rowId → colId → resultado da fórmula. */
  results: Map<string, Map<string, Scalar>>;
  /** Células em referência circular ("B5"). */
  circular: string[];
};

/**
 * Recalcula todas as fórmulas da planilha (ordem de dependência automática,
 * memória por célula, detecção de referência circular — o Excel mostra 0 e
 * avisa na barra de status; aqui também).
 */
export function recalcSheet(sheet: SheetForCalc): CalcResult {
  const { columns, rows, refs } = sheet;
  const results = new Map<string, Map<string, Scalar>>();
  const memo = new Map<string, Scalar>();
  const visiting = new Set<string>();
  const circular = new Set<string>();

  const ctx: EvalContext = {
    columns,
    dataRows: rows.length,
    today: sheet.today,
    cell(c, r) {
      const col = columns[c];
      if (!col) return ERR.ref();
      if (r === 1) return col.name;
      const row = rows[r - 2];
      if (!row) return null;
      const f = row.formulas?.[col.id];
      if (!f) return storedToScalar(col.type, row.values[col.id], refs);
      return cellValue(c, r);
    },
  };

  function cellValue(c: number, r: number): Scalar {
    const key = `${r}:${c}`;
    if (memo.has(key)) return memo.get(key)!;
    if (visiting.has(key)) {
      circular.add(`${indexToLetter(c)}${r}`);
      return 0;
    }
    visiting.add(key);
    const row = rows[r - 2];
    const col = columns[c];
    let v = evaluateFormula(row.formulas![col.id], r, ctx);
    // Resultado no formato da coluna (porcentagem/data) — como o Excel aplica o formato da célula.
    if (typeof v === "number" && !Number.isFinite(v)) v = ERR.num();
    visiting.delete(key);
    memo.set(key, v);
    return v;
  }

  rows.forEach((row, i) => {
    if (!row.formulas) return;
    for (const colId of Object.keys(row.formulas)) {
      const c = columns.findIndex((col) => col.id === colId);
      if (c < 0) continue;
      const v = cellValue(c, i + 2);
      let byCol = results.get(row.id);
      if (!byCol) results.set(row.id, (byCol = new Map()));
      byCol.set(colId, v);
    }
  });
  return { results, circular: [...circular] };
}

// ─── Excluir/restaurar linhas: reescrever referências (como o Excel) ──

/**
 * Mapa de linha antiga → linha nova depois de excluir/restaurar linhas.
 * `bias` decide o que fazer com linha que deixou de existir: "exact" =
 * sumiu (#REF!); "down"/"up" = ponta de intervalo encosta na vizinha
 * sobrevivente (o Excel encolhe o intervalo em vez de quebrar).
 */
export type RowMap = (row: number, bias: "exact" | "down" | "up") => number | null;

/**
 * Reescreve uma fórmula guardada quando linhas são excluídas/restauradas:
 * `ownBefore`/`ownAfter` = linha da própria célula antes/depois. Referência à
 * linha excluída vira #REF!; abaixo dela, sobe; intervalo que perde uma ponta
 * encolhe; intervalo que some inteiro vira #REF!. Coluna inteira (C:C) não muda.
 */
export function remapFormulaRows(internal: string, ownBefore: number, ownAfter: number, map: RowMap): string {
  const body = internal.startsWith("=") ? internal.slice(1) : internal;
  let toks: Tok[];
  try {
    toks = tokenize(body, "internal");
  } catch {
    return internal;
  }
  const spec = (ref: RefSpec, newRow: number) =>
    `⟦${ref.colAbs ? "$" : ""}${ref.col}|${ref.rowAbs ? `$${newRow}` : `~${newRow - ownAfter}`}⟧`;
  const oldRow = (ref: RefSpec) => (ref.rowAbs ? ref.row : ownBefore + ref.row);
  let out = "";
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== "ref") {
      out += t.raw;
      continue;
    }
    const b = toks[i + 1]?.t === ":" ? toks[i + 2] : undefined;
    if (b && b.t === "ref") {
      i += 2;
      if (t.ref.whole || b.ref.whole) {
        out += `${t.raw}:${b.raw}`;
        continue;
      }
      const aOld = oldRow(t.ref);
      const bOld = oldRow(b.ref);
      const [lo, hi] = aOld <= bOld ? [aOld, bOld] : [bOld, aOld];
      const loNew = map(lo, "down");
      const hiNew = map(hi, "up");
      if (loNew === null || hiNew === null || loNew > hiNew) {
        out += "#REF!";
        continue;
      }
      out += aOld <= bOld ? `${spec(t.ref, loNew)}:${spec(b.ref, hiNew)}` : `${spec(t.ref, hiNew)}:${spec(b.ref, loNew)}`;
      continue;
    }
    if (t.ref.whole) {
      out += t.raw;
      continue;
    }
    const n = map(oldRow(t.ref), "exact");
    out += n === null ? "#REF!" : spec(t.ref, n);
  }
  return `=${out}`;
}

/**
 * Mapa para excluir linhas: `oldRanks` = posição (1…n) de cada linha antes;
 * `removed` = posições que saem. Linha 1 (cabeçalho) nunca muda.
 */
export function rowMapForRemoval(oldCount: number, removed: Set<number>): RowMap {
  const sorted = [...removed].sort((a, b) => a - b);
  const removedBefore = (rank: number) => {
    let n = 0;
    for (const r of sorted) if (r < rank) n++;
    else break;
    return n;
  };
  return (row, bias) => {
    if (row <= 1) return row;
    const rank = row - 1;
    if (rank > oldCount) return row - sorted.length; // linhas vazias abaixo dos dados sobem junto
    if (!removed.has(rank)) return rank - removedBefore(rank) + 1;
    if (bias === "exact") return null;
    let k = rank;
    while (removed.has(k)) k += bias === "down" ? 1 : -1;
    if (k < 1) return null;
    if (k > oldCount) return bias === "down" ? null : k - removedBefore(k) + 1;
    return k - removedBefore(k) + 1;
  };
}

/** Mapa para restaurar linhas (o inverso da exclusão): `inserted` = posições NOVAS que voltam. */
export function rowMapForInsertion(insertedNewRanks: Set<number>): RowMap {
  const sorted = [...insertedNewRanks].sort((a, b) => a - b);
  return (row) => {
    if (row <= 1) return row;
    let rank = row - 1;
    // Posição antiga k vira a k-ésima posição nova que NÃO é inserida.
    for (const r of sorted) if (r <= rank) rank++;
    else break;
    return rank + 1;
  };
}
