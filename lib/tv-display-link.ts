/**
 * Geração/hash/normalização do código do link público (sem login) da TV.
 *
 * Trocado de um token longo (54 caracteres, tipo API key) pra um código
 * curto digitável no controle remoto de uma TV — pedido explícito depois do
 * primeiro formato provar ser impraticável de digitar num teclado na tela
 * ("na tv a gente tem que digitar, seria mais fácil"). Continua seguro
 * ("com segurança ainda assim", pedido explícito também) por duas camadas
 * que já existiam pra ApiKey e agora se aplicam aqui também:
 *   1. Nunca persistido em texto puro — só o hash (mesmo raciocínio de
 *      lib/api-keys.ts).
 *   2. 12 caracteres num alfabeto de 32 símbolos = 32^12 ≈ 1,15×10¹⁸
 *      combinações (~60 bits de entropia) — mesma ordem de grandeza de uma
 *      senha de Wi-Fi forte (que todo mundo já digita em TV numa boa), MUITO
 *      acima do que dá pra tentar adivinhar por força bruta, ainda mais com
 *      o rate limit por IP em lib/require-tv-link.ts por cima.
 *
 * Alfabeto Crockford Base32 (0-9 + A-Z sem I/L/O/U) — desenhado
 * especificamente pra digitação humana: sem letra parecida com número
 * (I/l/1, O/0) sobrando pra confundir em quem está lendo/digitando numa
 * tela a alguns metros de distância. 256 % 32 === 0 (32 é potência de 2),
 * então mapear byte aleatório → símbolo por `% 32` já é perfeitamente
 * uniforme, sem viés — não precisa de rejection sampling.
 */

import { randomBytes, createHash } from "node:crypto";

const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 12;
/** Grupos de 4 pra exibição ("K7XP-Q2M9-8ANW") — mais fácil de ler/digitar/
 * conferir em voz alta do que uma sequência corrida de 12 caracteres. */
const GROUP_SIZE = 4;

export function hashTvDisplayLinkCode(normalizedCode: string): string {
  return createHash("sha256").update(normalizedCode).digest("hex");
}

/** Tira espaço/traço e uppercase — quem digita no controle da TV (ou copia
 * do celular) não deveria precisar acertar exatamente onde os traços
 * ficam nem a caixa das letras. Usado tanto ao GERAR (garantir que o que
 * fica salvo já está normalizado) quanto ao LER de volta (o que o usuário
 * digitou/colou), pra hash bater dos dois lados. */
export function normalizeTvDisplayLinkCode(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function formatTvDisplayLinkCode(normalizedCode: string): string {
  const groups: string[] = [];
  for (let i = 0; i < normalizedCode.length; i += GROUP_SIZE) {
    groups.push(normalizedCode.slice(i, i + GROUP_SIZE));
  }
  return groups.join("-");
}

export function generateTvDisplayLinkCode(): {
  /** Sem traço, uppercase — o que é hasheado/salvo. */
  code: string;
  /** Com traço, pra exibir/copiar ("K7XP-Q2M9-8ANW") — funciona igual se
   * digitado sem os traços (ver normalizeTvDisplayLinkCode). */
  displayCode: string;
  /** 1º grupo, pra UI de gestão mostrar sem expor o código inteiro de novo
   * (mesmo espírito do keyPrefix de ApiKey). */
  codePrefix: string;
  codeHash: string;
} {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return {
    code,
    displayCode: formatTvDisplayLinkCode(code),
    codePrefix: code.slice(0, GROUP_SIZE),
    codeHash: hashTvDisplayLinkCode(code),
  };
}
