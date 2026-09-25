/**
 * Neutraliza CSV/Formula Injection (OWASP): células que começam com =, +, -, @,
 * tabulação ou retorno de carro são interpretadas como fórmula pelo Excel/Google
 * Sheets ao abrir o arquivo, podendo executar comandos no computador de quem abre.
 * Prefixar com aspas simples força a leitura como texto puro.
 */
const DANGEROUS_PREFIXES = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Cara de número de telefone: "+" opcional no início e depois SÓ dígitos,
 * espaço, parênteses e hífen ("+5567999999999", "+351 968 203 610",
 * "+1 (917) 555-1234"). Uma string assim não carrega fórmula perigosa — o
 * ataque precisa de letras (nome de função, "cmd|…"), "=", "@" ou aspas, e
 * nenhum deles cabe aqui — então NÃO se prefixa.
 *
 * Existe por causa de um bug real de produção: todo número com DDI começa com
 * "+", o prefixo "'" era gravado NO BANCO ("'+5567999999999" — 313 contatos,
 * 235 numa única importação) e o número aparecia com apóstrofo na tela, no
 * WhatsApp e na exportação. Não usa \s de propósito: tabulação/quebra de linha
 * no começo continuam sendo prefixo perigoso.
 */
const PHONE_LIKE = /^\+? *\d[\d ()-]*$/;

export function sanitizeCell<T>(value: T): T {
  if (typeof value !== "string" || value.length === 0) return value;
  if (PHONE_LIKE.test(value)) return value;
  return (DANGEROUS_PREFIXES.has(value[0]) ? `'${value}` : value) as T;
}
