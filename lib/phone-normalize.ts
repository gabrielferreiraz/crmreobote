/**
 * Normaliza um número de telefone/WhatsApp brasileiro para uma forma canônica
 * comparável, removendo toda a formatação (espaços, parênteses, traços, +),
 * o código do país (55) e um eventual zero de tronco à esquerda — assim
 * "+55 (11) 98765-4321", "011 98765-4321" e "11987654321" são reconhecidos
 * como o mesmo número.
 *
 * Retorna `null` quando não sobra nenhum dígito (campo vazio/whitespace).
 */
export function normalizePhoneNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;

  // Código do país (55) só é removido se, depois de tirado, ainda sobrar um
  // número plausível de DDD+telefone (10 ou 11 dígitos) — evita confundir um
  // número local que por acaso comece com "55".
  if (digits.length > 11 && digits.startsWith("55") && digits.length - 2 <= 11) {
    digits = digits.slice(2);
  }

  // Zero de tronco (ex.: "0 11 98765-4321"), mesma lógica de segurança.
  if (digits.length > 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  return digits || null;
}

/**
 * Valida se um número de telefone tem formato aceitável antes de salvar.
 * Retorna `true` para campo vazio/null (opcional) ou para números que, após
 * remover os separadores padrão (espaços, traços, parênteses, +), resultem
 * somente em dígitos com comprimento entre 7 e 15 (padrão E.164).
 *
 * Rejeita entradas como ", 6799 615." ou "98765-abc" que claramente não são
 * números — caracteres como vírgula, ponto, letras etc. não fazem parte de
 * nenhum formato telefônico válido.
 */
export function isValidPhoneInput(raw: string | null | undefined): boolean {
  if (!raw || !raw.trim()) return true; // campo vazio é ok (opcional)
  // Remove apenas os separadores que existem em formatos reais de telefone —
  // ponto NUNCA entra aqui de propósito (bug corrigido: um "." solto no meio
  // do character class abaixo era removido como se fosse formatação válida,
  // então "6799 615." ou "67.99961.5000" passavam como válidos mesmo tendo
  // ponto, contradizendo a própria regra documentada acima).
  const stripped = raw.trim().replace(/^[+]/, "").replace(/[\s\-()]/g, "");
  // Depois de remover formatação legítima, só dígitos devem restar
  if (!/^\d+$/.test(stripped)) return false;
  // E.164: mínimo 7, máximo 15 dígitos
  return stripped.length >= 7 && stripped.length <= 15;
}

/**
 * Máscara "ao vivo" de telefone/WhatsApp enquanto a pessoa digita. Número
 * BRASILEIRO sempre aparece com o DDI: `+55 (DD) NNNNN-NNNN` (celular, 11
 * dígitos) ou `+55 (DD) NNNN-NNNN` (fixo, 10 dígitos). Só dá pra saber se o
 * número é celular ou fixo depois que o 11º dígito é digitado (os dois
 * começam iguais) — o traço "pula" de posição nesse instante, comportamento
 * normal de qualquer máscara de telefone brasileira.
 *
 * Brasileiro = o que foi digitado só com DDD+número (o "+55 " é acrescentado
 * sozinho, assim que o primeiro dígito entra), com "+55" na frente, ou com o
 * 55 colado (12/13 dígitos, ex.: número copiado de outro lugar).
 *
 * Número de OUTRO país — "+" seguido de um DDI que não é 55, ou mais de 11
 * dígitos sem "+55" (a empresa atende cliente de fora, ver comentário de
 * VALID_BRAZILIAN_DDDS acima) — a máscara desiste de agrupar e devolve só os
 * dígitos (com o "+" na frente, se foi digitado): nunca reordena nem descarta
 * o que a pessoa digitou, só decide se desenha parênteses/traço ou não. Pra
 * digitar um número de fora, comece com "+".
 */
export function formatPhoneMask(raw: string): string {
  const hasPlus = raw.trimStart().startsWith("+");
  const digits = raw.replace(/\D/g, "");

  // "+" com DDI que não é 55 (ou ainda só "+" / "+5", sem dar pra saber):
  // sem agrupar, exatamente o que foi digitado.
  if (hasPlus && !digits.startsWith("55")) return `+${digits}`;

  let national: string;
  if (hasPlus) {
    national = digits.slice(2);
  } else if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    national = digits.slice(2);
  } else if (digits.length <= 11) {
    national = digits;
  } else {
    return digits; // 12+ dígitos que não são "55 + número": não é brasileiro reconhecível
  }

  if (national.length > 11) return `+${digits}`; // sobrou dígito: não agrupa (o servidor recusa)
  if (national.length === 0) return hasPlus ? "+55" : "";

  const len = national.length;
  if (len <= 2) return `+55 (${national}`;
  const ddd = national.slice(0, 2);
  if (len <= 6) return `+55 (${ddd}) ${national.slice(2)}`;
  const splitAt = len === 11 ? 7 : 6;
  return `+55 (${ddd}) ${national.slice(2, splitAt)}-${national.slice(splitAt)}`;
}

/**
 * Aplica formatPhoneMask e devolve também onde o cursor deve ficar. Conta os
 * dígitos DEPOIS do cursor (não antes): a máscara acrescenta o "+55 " na
 * frente quando a pessoa digita só o número nacional, então contar dígitos
 * antes do cursor erraria a posição por causa desses dígitos extras — depois
 * do cursor a contagem não muda nunca, e editar no MEIO do número continua
 * funcionando (o cursor não foge pro fim a cada tecla).
 */
export function applyPhoneMask(raw: string, caret: number): { value: string; caret: number } {
  const value = formatPhoneMask(raw);
  const digitsAfterCaret = raw.slice(Math.max(0, Math.min(caret, raw.length))).replace(/\D/g, "").length;
  if (digitsAfterCaret === 0) return { value, caret: value.length };

  let seen = 0;
  for (let i = value.length - 1; i >= 0; i--) {
    if (value[i] >= "0" && value[i] <= "9") {
      seen++;
      if (seen === digitsAfterCaret) return { value, caret: i };
    }
  }
  return { value, caret: 0 };
}


/**
 * Praticamente todo celular no Brasil também é WhatsApp — contato que fica
 * com celular preenchido e WhatsApp vazio MUDA o número pro campo WhatsApp
 * (não copia: o celular fica vazio depois, o número passa a existir só num
 * lugar). Cadastro manual, edição, importação em massa, upsert de
 * integração externa e a migração do Agendor aplicam essa mesma regra.
 */
export function fallbackWhatsappToPhone(
  phone: string | null | undefined,
  phoneNormalized: string | null,
  whatsapp: string | null | undefined,
  whatsappNormalized: string | null,
): { phone: string | null; phoneNormalized: string | null; whatsapp: string | null; whatsappNormalized: string | null } {
  if (whatsappNormalized) {
    return withNinthDigitFix(phone ?? null, phoneNormalized, whatsapp ?? null, whatsappNormalized);
  }
  // Fixo NÃO vira WhatsApp (linha fixa não recebe mensagem) — fica no Celular.
  if (phoneNormalized && !isBrazilianLandline(phoneNormalized)) {
    return withNinthDigitFix(null, null, phone ?? null, phoneNormalized);
  }
  return { phone: phone ?? null, phoneNormalized: phoneNormalized ?? null, whatsapp: whatsapp ?? null, whatsappNormalized: whatsappNormalized ?? null };
}

/**
 * Aplica ensureBrazilianMobileNinthDigit no valor que vai virar
 * whatsappNormalized e, quando ele de fato muda (9 estava faltando),
 * reconstrói TAMBÉM o campo de exibição (`whatsapp`) a partir do valor já
 * corrigido — pedido explícito: o número tem que estar certo "antes mesmo
 * de aparecer na interface pro usuário", não só no campo interno usado pra
 * discar/comparar. Chamado nos dois ramos de fallbackWhatsappToPhone
 * acima (whatsapp já preenchido, ou celular que acabou de virar whatsapp).
 */
function withNinthDigitFix(
  phone: string | null,
  phoneNormalized: string | null,
  whatsapp: string | null,
  whatsappNormalized: string,
): { phone: string | null; phoneNormalized: string | null; whatsapp: string | null; whatsappNormalized: string | null } {
  const corrected = ensureBrazilianMobileNinthDigit(whatsappNormalized);
  if (corrected === whatsappNormalized) {
    return { phone, phoneNormalized, whatsapp, whatsappNormalized };
  }
  return { phone, phoneNormalized, whatsapp: formatPhoneMask(corrected!), whatsappNormalized: corrected };
}

/**
 * Extrai a parte "usuário" de um JID do WhatsApp — ex.:
 * "5511999998888:14@s.whatsapp.net" → "5511999998888". O ":14" é o id do
 * aparelho (multi-device); mensagens normalmente chegam sem ele, mas
 * eventos de CHAMADA do Baileys/Evolution costumam incluir, e passar isso
 * direto pra normalizePhoneNumber (que só remove caractere não-dígito, sem
 * saber o que é sufixo de aparelho) funde o id do aparelho no número —
 * gerava uma conversa nova e mal formatada em vez de casar com a já
 * existente. Sempre usar isso antes de normalizar um JID cru.
 */
export function extractJidUser(jid: string): string {
  return jid.split("@")[0].split(":")[0];
}

/**
 * JIDs do WhatsApp cujo "usuário" (parte antes do @) NÃO é um número de
 * telefone de verdade — passar isso pra extractJidUser/normalizePhoneNumber
 * mesmo assim produz uma sequência de dígitos que PARECE número mas não é
 * discável nem real (visto em produção: "253274825482433" virando
 * "+253274825482433" na tela por causa de um contato @lid). Grupo (@g.us)
 * já era filtrado nos handlers de webhook antes desta função existir; os
 * outros três têm exatamente o mesmo problema e nunca tinham sido tratados:
 *
 *  - @lid: "Linked ID" — identificador que o WhatsApp usa quando o número
 *    de telefone real do contato fica oculto (recurso de privacidade mais
 *    recente da plataforma). O Evolution não expõe hoje um jeito confirmado
 *    de resolver isso pro número de verdade, então melhor não criar a
 *    conversa com um número inventado do que criar errado.
 *  - @broadcast: lista de transmissão.
 *  - @newsletter: canal (WhatsApp Channels).
 */
export function isNonIndividualJid(jid: string): boolean {
  return jid.endsWith("@g.us") || jid.endsWith("@lid") || jid.endsWith("@broadcast") || jid.endsWith("@newsletter");
}

// DDDs válidos no Brasil (todos os códigos de área de 2 dígitos realmente
// atribuídos pela Anatel) — usado só pra decidir se um número de 10/11
// dígitos É de fato brasileiro antes de aplicar a correção de 9º dígito
// abaixo. Sem isso, um número ESTRANGEIRO que por coincidência tenha 11
// dígitos com "9" na 3ª posição (ex.: um número dos EUA com DDD fictício
// "917") seria tratado como brasileiro e geraria uma variante errada —
// relevante porque a empresa vende pra clientes da UE/EUA também, não só
// Brasil.
export const VALID_BRAZILIAN_DDDS = new Set([
  "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "21", "22", "24", "27", "28",
  "31", "32", "33", "34", "35", "37", "38",
  "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "51", "53", "54", "55",
  "61", "62", "63", "64",
  "65", "66", "67", "68", "69",
  "71", "73", "74", "75", "77", "79",
  "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "91", "92", "93", "94", "95", "96", "97", "98", "99",
]);

/**
 * O JID que o WhatsApp manda numa mensagem recebida às vezes vem sem o 9º
 * dígito do celular (ex.: "6781783902", 10 dígitos), mesmo quando o número
 * de verdade — e o que está salvo no contato — tem os 11 (o 9 que virou
 * obrigatório em todos os DDDs do Brasil). Isso é um comportamento conhecido
 * do WhatsApp/Baileys, não um erro de digitação. Sem considerar as duas
 * formas na hora de casar com um contato, mensagem recebida de um número
 * salvo com o 9 nunca encontra o contato.
 *
 * Só se aplica quando os 2 primeiros dígitos são um DDD brasileiro válido —
 * número de fora (UE/EUA) com 10/11 dígitos por coincidência não deve
 * receber essa correção, que faria sentido só pro padrão de celular do
 * Brasil.
 */
export function brazilianMobileVariants(normalized: string): string[] {
  const variants = new Set([normalized]);
  if (!VALID_BRAZILIAN_DDDS.has(normalized.slice(0, 2))) return Array.from(variants);
  if (normalized.length === 11 && normalized[2] === "9") {
    variants.add(normalized.slice(0, 2) + normalized.slice(3));
  } else if (normalized.length === 10) {
    variants.add(normalized.slice(0, 2) + "9" + normalized.slice(2));
  }
  return Array.from(variants);
}

/**
 * Corrige um número JÁ normalizado (só dígitos, sem DDI) que veio sem o 9º
 * dígito do celular — mesmo fenômeno documentado em brazilianMobileVariants
 * acima (o WhatsApp às vezes entrega o JID de uma mensagem com 10 dígitos
 * em vez de 11), só que aqui é pra CORRIGIR o valor guardado, não pra gerar
 * uma variante de busca.
 *
 * Só chamar em contexto de WHATSAPP (nunca em `phone` genérico): um número
 * de telefone comum de 10 dígitos pode legitimamente ser fixo (2-5 no
 * início, 8 dígitos depois do DDD) — adicionar um 9 nesse caso inventaria
 * um celular que não existe. WhatsApp não roda em linha fixa (a integração
 * Evolution/Baileys é sempre um número de celular de verdade), então um
 * whatsappNormalized de 10 dígitos num DDD brasileiro válido É, com certeza
 * prática, um celular sem o 9 — nunca um fixo — seguro de corrigir sempre.
 *
 * Pedido explícito: número de WhatsApp tem que ter DDI+DDD+9 antes mesmo de
 * aparecer pro usuário — usado tanto na gravação (fallbackWhatsappToPhone
 * abaixo) quanto, como rede de segurança, no exato momento de discar (ver
 * lib/whatsapp/send.ts) — corrige mesmo um `WhatsAppThread.phoneNormalized`
 * antigo, gravado antes desta correção existir, sem precisar de backfill
 * pra o envio funcionar.
 */
export function ensureBrazilianMobileNinthDigit(normalized: string | null): string | null {
  if (!normalized) return normalized;
  if (normalized.length !== 10) return normalized;
  const ddd = normalized.slice(0, 2);
  if (!VALID_BRAZILIAN_DDDS.has(ddd)) return normalized;
  // Só o celular ANTIGO (8 dígitos, começando com 6-9) ganhou um 9 na frente.
  // Fixo começa com 2-5 depois do DDD (plano de numeração da Anatel) e NUNCA
  // recebe o 9 — versão anterior desta função somava o 9 em qualquer número
  // de 10 dígitos e transformou telefone fixo de empresa ("(67) 3321-8101")
  // num celular que não existe ("(67) 93321-8101"), medido em produção.
  if (normalized[2] < "6" || normalized[2] > "9") return normalized;
  return ddd + "9" + normalized.slice(2);
}

/**
 * Número já normalizado (só dígitos, sem DDI) que TEM cara de brasileiro de
 * verdade — DDD existente e formato de celular (11 dígitos, 9 depois do DDD)
 * ou de fixo/celular antigo (10 dígitos, 2-9 depois do DDD). É o critério que
 * separa "isso é do Brasil, disca com 55 na frente" de "isso já vem com o DDI
 * de outro país" (ver toDialNumber).
 */
export function isBrazilianShaped(normalized: string): boolean {
  if (!/^\d{10,11}$/.test(normalized)) return false;
  if (!VALID_BRAZILIAN_DDDS.has(normalized.slice(0, 2))) return false;
  if (normalized.length === 11) return normalized[2] === "9";
  return normalized[2] >= "2" && normalized[2] <= "9";
}

/** 10 dígitos, DDD válido, começando com 2-5 depois do DDD = telefone fixo. */
export function isBrazilianLandline(normalized: string | null | undefined): boolean {
  if (!normalized || !/^\d{10}$/.test(normalized)) return false;
  if (!VALID_BRAZILIAN_DDDS.has(normalized.slice(0, 2))) return false;
  return normalized[2] >= "2" && normalized[2] <= "5";
}

/**
 * Número COMPLETO (DDI + tudo, só dígitos) pra entregar ao WhatsApp — o
 * Evolution API e a API oficial da Meta esperam E.164 sem o "+". Número
 * brasileiro (formato de DDD + celular/fixo) ganha o 55; número de outro país
 * já vem com o próprio DDI dentro do valor normalizado (é a convenção de
 * `whatsappNormalized`: só o Brasil fica sem DDI) e segue como está.
 *
 * Antes cada ponto de envio fazia `55${...}` direto — todo número de fora
 * (Portugal, EUA, Espanha…) virava um número inexistente ("55351968203610").
 * Já aplica a correção do 9º dígito (rede de segurança, ver acima).
 */
export function toDialNumber(normalized: string | null | undefined): string | null {
  if (!normalized) return null;
  const fixed = ensureBrazilianMobileNinthDigit(normalized) ?? normalized;
  return isBrazilianShaped(fixed) ? `55${fixed}` : fixed;
}

/**
 * Forma legível pra exibir na UI (ex.: "+55 (67) 99178-3902") — nunca usar
 * isso pra comparar/buscar, só pra mostrar. Só formata como brasileiro
 * (DDD entre parênteses, +55 na frente) quando os 2 primeiros dígitos são
 * um DDD válido de verdade — número de fora (UE/EUA) só ganha um "+" na
 * frente, sem fingir agrupamento de DDD que não existe pra ele, senão um
 * número português aparecia rotulado como brasileiro na tela.
 */
export function formatBrazilianPhone(normalized: string | null | undefined): string | null {
  if (!normalized) return null;
  // Mostra o 9º dígito que faltava: o WhatsApp entrega o JID de uma mensagem
  // recebida às vezes sem o 9 (e há contatos antigos salvos assim) — o número
  // MOSTRADO é o mesmo que será DISCADO (ver toDialNumber), nunca um 10º
  // dígito a menos que a pessoa não reconhece. Fixo (2-5 depois do DDD) nunca
  // ganha o 9.
  const withNinth = ensureBrazilianMobileNinthDigit(normalized) ?? normalized;
  // Só rotula "+55" o que tem formato de brasileiro DE VERDADE (DDD + celular
  // de 9 dígitos começando com 9, ou fixo de 8) — checar só o DDD errava
  // número de fora cujos 2 primeiros dígitos coincidem com um DDD ("351…" de
  // Portugal virava "DDD 35"), e lixo de 11 dígitos sem 9 virava
  // "+55 (DD) 1xxxx-xxxx" como se fosse um celular.
  if (!isBrazilianShaped(withNinth)) return `+${normalized}`;
  return formatBrazilianDisplay(withNinth);
}

/**
 * Mesma ideia de formatBrazilianPhone, mas recebe o número CRU (com ou sem
 * formatação) — usado pelo Cartão Digital (lib/digital-cards/queries.ts e
 * o preview em "Meu Cartão", app/(dashboard)/configuracoes/meu-cartao/
 * card-editor.tsx). Vive aqui (não em lib/digital-cards/queries.ts) de
 * propósito: aquele módulo importa `prisma`/`sharp`/`pg` no topo, e
 * card-editor.tsx é "use client" — importar de lá quebrava o build
 * (Turbopack tentava colocar `pg`/`sharp`/`fs`/`dns`/`tls` no bundle do
 * navegador). Esta função é pura, sem nenhuma dependência de servidor.
 */
export function displayPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Número reconhecível (Brasil ou "+DDI" de fora): a mesma forma canônica
  // que é gravada no contato — "+55 (67) 99999-9999" / "+351 968 203 610",
  // já com o 9º dígito.
  const parsed = parsePhone(raw, "phone");
  if (parsed.ok && parsed.phone && parsed.phone.kind !== "OTHER") return parsed.phone.display;
  // Não reconhecível (só dígitos de outro país sem "+", texto legado...):
  // normalizePhoneNumber (não só "tirar não-dígito") tira o 55 e o zero de
  // tronco antes de formatar — "+5567999999999" virava lixo ("+55 5567…")
  // porque o 55 ficava junto do DDD.
  const normalized = normalizePhoneNumber(raw);
  return (normalized ? formatBrazilianPhone(normalized) : null) ?? raw;
}

// ═════════════════════════════════════════════════════════════════════
// FONTE ÚNICA: limpeza + validação + máscara de telefone
// ═════════════════════════════════════════════════════════════════════
//
// TODO ponto que GRAVA telefone/WhatsApp de contato (cadastro, edição,
// importação de contatos e de negócios, API externa, anúncios da Meta) passa
// por resolveContactPhones abaixo — nenhum valor cru chega ao banco. É o que
// garante, num lugar só, que um número gravado:
//   - nunca tem apóstrofo/aspas/caractere invisível (bug real de produção:
//     "'+5567999999999" — o sanitizeCell de lib/csv-sanitize.ts prefixava um
//     "'" em tudo que começa com "+", e todo número com DDI começa assim);
//   - fica no formato com máscara: "(67) 99999-9999" (Brasil) ou
//     "+351 968 203 610" (outro país);
//   - foi validado (DDD existente, celular com 9, DDI conhecido, tamanho).
//
// Convenção de `*Normalized` (NÃO mudou): Brasil só com DDD+número (10/11
// dígitos, sem o 55); número de outro país guarda o DDI junto ("351968203610").

/** Aspas/apóstrofos de qualquer tipo — nunca fazem parte de um telefone. */
const QUOTE_LIKE = /['\u2018\u2019\u201A\u201B\u2032\u00B4\u0060"\u201C\u201D\u201E\u201F\u2033]/g;
/** Caracteres invisíveis que vêm de copiar/colar (WhatsApp, PDF, Word) + acentos soltos. */
const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u0300-\u036F]/g;
const SCIENTIFIC_NOTATION = /^\d+(?:[.,]\d+)?[eE][+-]?\d+$/;
/** Depois da limpeza só resta: dígitos, espaço, parênteses, hífen e um "+" no início. */
const PHONE_CHARSET = /^\+?[0-9 ()-]+$/;

/**
 * Códigos de país (DDI) do plano ITU-T E.164 — usado pra reconhecer o DDI de
 * um número internacional ("+351…") e separá-lo do resto. A lista é livre de
 * prefixo por construção (nenhum código é o começo de outro), então dado um
 * número o DDI é único. Só validação/separação: número cujo país não esteja
 * aqui é recusado com uma mensagem clara (o Celular, mais flexível, aceita).
 */
const COUNTRY_CODES = new Set(
  (
    "1 7 20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 " +
    "81 82 84 86 90 91 92 93 94 95 98 " +
    "211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 238 239 240 " +
    "241 242 243 244 245 246 247 248 249 250 251 252 253 254 255 256 257 258 260 261 262 263 264 265 266 267 " +
    "268 269 290 291 297 298 299 350 351 352 353 354 355 356 357 358 359 370 371 372 373 374 375 376 377 378 " +
    "379 380 381 382 383 385 386 387 389 420 421 423 500 501 502 503 504 505 506 507 508 509 590 591 592 593 " +
    "594 595 596 597 598 599 670 672 673 674 675 676 677 678 679 680 681 682 683 685 686 687 688 689 690 691 " +
    "692 850 852 853 855 856 880 886 960 961 962 963 964 965 966 967 968 970 971 972 973 974 975 976 977 992 " +
    "993 994 995 996 998"
  ).split(" "),
);

function findCountryCode(digits: string): string | null {
  for (let len = 1; len <= 3; len++) {
    const prefix = digits.slice(0, len);
    if (prefix.length === len && COUNTRY_CODES.has(prefix)) return prefix;
  }
  return null;
}

/**
 * Tira de um texto de telefone tudo que não é telefone, ANTES de qualquer
 * validação: apóstrofos/aspas (o "'" que o Excel/planilha põe pra "forçar
 * texto" e o que o sanitizeCell punha), caracteres invisíveis, o "=" do
 * `="5567…"` que alguns exportadores usam, prefixos "tel:"/"whatsapp:", link
 * wa.me, dígitos de largura total e o ".0" que uma planilha acrescenta a
 * número inteiro ("5567999999999.0"). Devolve só o que sobrou, já com espaços
 * colapsados — pode devolver "" (campo vazio).
 */
export function cleanPhoneText(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  let s = String(raw).replace(QUOTE_LIKE, "").normalize("NFKC").replace(INVISIBLE, "").trim();
  s = s.replace(/^=\s*/, "");
  s = s.replace(/^(?:tel|callto|sms|whatsapp)\s*:\s*/i, "");
  const waLink = s.match(/^(?:https?:\/\/)?(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=)(\d+)/i);
  if (waLink) s = `+${waLink[1]}`;
  s = s.replace(/^(\d+)[.,]0+$/, "$1");
  return s.replace(/\s+/g, " ").trim();
}

export type PhoneContext = "whatsapp" | "phone";

export type PhoneErrorCode =
  | "INVALID_CHARS"
  | "SCIENTIFIC_NOTATION"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "INVALID_DDD"
  | "INVALID_BR_MOBILE"
  | "INVALID_BR_NUMBER"
  | "UNKNOWN_DDI"
  | "INVALID_INTL_LENGTH"
  | "LANDLINE_NOT_WHATSAPP";

export type PhoneKind = "BR_MOBILE" | "BR_LANDLINE" | "INTERNATIONAL" | "OTHER";

export type ParsedPhone = {
  kind: PhoneKind;
  /** "55", "351"… — null só em kind "OTHER" (Celular sem DDD que a gente não sabe interpretar). */
  ddi: string | null;
  /** Valor pra Contact.phoneNormalized / whatsappNormalized (convenção acima). */
  normalized: string;
  /** Valor pra Contact.phone / whatsapp — COM máscara. */
  display: string;
  /** Número completo com DDI, só dígitos (o que o WhatsApp recebe) — null em kind "OTHER". */
  e164: string | null;
  /** true quando faltava o 9º dígito e ele foi acrescentado (só contexto "whatsapp"). */
  ninthDigitAdded: boolean;
};

export type PhoneParseResult =
  | { ok: true; phone: ParsedPhone | null } // phone null = campo vazio (não é erro)
  | { ok: false; code: PhoneErrorCode; message: string };

export type PhoneShape =
  | { ok: true; kind: "BR_MOBILE" | "BR_MOBILE_NO9" | "BR_LANDLINE"; ddi: "55"; national: string }
  | { ok: true; kind: "INTERNATIONAL"; ddi: string; national: string }
  | { ok: false; code: PhoneErrorCode; ddd?: string; ddi?: string };

function classifyBrazilian(national: string): PhoneShape {
  if (national.length < 10) return { ok: false, code: "TOO_SHORT" };
  if (national.length > 11) return { ok: false, code: "TOO_LONG" };
  const ddd = national.slice(0, 2);
  if (!VALID_BRAZILIAN_DDDS.has(ddd)) return { ok: false, code: "INVALID_DDD", ddd };
  const third = national[2];
  if (national.length === 11) {
    return third === "9" ? { ok: true, kind: "BR_MOBILE", ddi: "55", national } : { ok: false, code: "INVALID_BR_MOBILE" };
  }
  if (third >= "2" && third <= "5") return { ok: true, kind: "BR_LANDLINE", ddi: "55", national };
  if (third >= "6" && third <= "9") return { ok: true, kind: "BR_MOBILE_NO9", ddi: "55", national };
  return { ok: false, code: "INVALID_BR_NUMBER" };
}

function classifyInternational(ddi: string, national: string): PhoneShape {
  const total = ddi.length + national.length;
  if (national.length < 4 || total < 7 || total > 15) return { ok: false, code: "INVALID_INTL_LENGTH", ddi };
  // EUA/Canadá (+1): sempre 10 dígitos, código de área começando com 2-9.
  if (ddi === "1" && !/^[2-9]\d{9}$/.test(national)) return { ok: false, code: "INVALID_INTL_LENGTH", ddi };
  return { ok: true, kind: "INTERNATIONAL", ddi, national };
}

/**
 * Interpretação ESTRUTURAL do número (sem regra de contexto): que tipo é, qual
 * o DDI, quais os dígitos nacionais. Recebe texto JÁ limpo (cleanPhoneText).
 *
 * Sem "+" (nem "00"), só existe Brasil: 10/11 dígitos (com o 55 e/ou o zero
 * de tronco opcionais). Número de OUTRO país precisa vir com "+" e o DDI —
 * um número solto de 12+ dígitos não dá pra distinguir de lixo, e aceitar
 * "qualquer coisa comprida" como internacional foi exatamente o que deixou
 * entrar telefone inválido no banco.
 */
export function parsePhoneShape(cleaned: string): PhoneShape {
  if (SCIENTIFIC_NOTATION.test(cleaned)) return { ok: false, code: "SCIENTIFIC_NOTATION" };
  if (!PHONE_CHARSET.test(cleaned)) return { ok: false, code: "INVALID_CHARS" };
  let digits = cleaned.replace(/\D/g, "");
  if (!digits) return { ok: false, code: "INVALID_CHARS" };
  // 6+ zeros no final de uma sequência de dígitos PUROS (sem máscara nenhuma)
  // = quase certamente um número que o Excel arredondou: 5.5679E+12 vira
  // 5567900000000 quando o leitor de CSV converte a célula pra número — tem
  // cara de telefone válido mas os dígitos reais se perderam. Só vale pra
  // dígitos colados: número digitado com máscara "(11) 90000-0000" (linha
  // "bonita" de empresa) nunca é barrado por isso.
  if (/^\+?\d+$/.test(cleaned) && /0{6,}$/.test(digits)) return { ok: false, code: "SCIENTIFIC_NOTATION" };

  let international = cleaned.startsWith("+");
  if (!international && digits.startsWith("00")) {
    international = true;
    digits = digits.slice(2);
  }

  if (international) {
    const ddi = findCountryCode(digits);
    if (!ddi) return { ok: false, code: "UNKNOWN_DDI" };
    let national = digits.slice(ddi.length);
    if (ddi === "55") {
      if (national.length > 11 && national.startsWith("0")) national = national.slice(1);
      return classifyBrazilian(national);
    }
    return classifyInternational(ddi, national);
  }

  // Zero de tronco ("067 99999-9999", "0 67 3333-4444") — o "0" nunca é DDD.
  if (
    (digits.length === 11 || digits.length === 12) &&
    digits.startsWith("0") &&
    VALID_BRAZILIAN_DDDS.has(digits.slice(1, 3))
  ) {
    digits = digits.slice(1);
  }
  // 55 na frente (12/13 dígitos) — só o Brasil usa 55, sem ambiguidade.
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    return classifyBrazilian(digits.slice(2));
  }
  if (digits.length === 10 || digits.length === 11) return classifyBrazilian(digits);
  return { ok: false, code: digits.length < 10 ? "TOO_SHORT" : "TOO_LONG" };
}

const FOREIGN_HINT = "Se o número for de outro país, comece com + e o código do país (ex.: +351 968 203 610).";

function phoneErrorMessage(shape: Extract<PhoneShape, { ok: false }>): string {
  switch (shape.code) {
    case "INVALID_CHARS":
      return "Formato inválido. Use apenas dígitos, espaços, traços ou parênteses (e + no início, para outro país).";
    case "SCIENTIFIC_NOTATION":
      return "O número parece ter sido arredondado pela planilha (notação científica, ex.: 5,5E+12) e os dígitos se perderam — formate a coluna como Texto e exporte de novo.";
    case "TOO_SHORT":
      return "Número incompleto — faltou o DDD. Use o formato +55 (67) 99999-9999.";
    case "TOO_LONG":
      return `Número com dígitos demais. ${FOREIGN_HINT}`;
    case "INVALID_DDD":
      return `DDD ${shape.ddd ?? "informado"} não existe no Brasil. ${FOREIGN_HINT}`;
    case "INVALID_BR_MOBILE":
      return "Celular brasileiro precisa ter 9 dígitos e começar com 9 depois do DDD.";
    case "INVALID_BR_NUMBER":
      return "Número brasileiro inválido — confira os dígitos depois do DDD.";
    case "UNKNOWN_DDI":
      return "Código de país (DDI) não reconhecido. Confira o número depois do +.";
    case "INVALID_INTL_LENGTH":
      return `Número internacional com quantidade de dígitos inválida${shape.ddi ? ` para o código +${shape.ddi}` : ""}.`;
    case "LANDLINE_NOT_WHATSAPP":
      return "Esse número é de telefone fixo — o WhatsApp precisa ser um celular. Coloque-o no campo Celular.";
  }
}

/** (DD) NNNNN-NNNN (celular, 11 dígitos) ou (DD) NNNN-NNNN (10 dígitos) — só o número nacional, sem o DDI. */
export function formatBrazilianMask(national: string): string {
  const ddd = national.slice(0, 2);
  if (national.length === 11) return `(${ddd}) ${national.slice(2, 7)}-${national.slice(7)}`;
  return `(${ddd}) ${national.slice(2, 6)}-${national.slice(6)}`;
}

/**
 * Forma como o número brasileiro é GRAVADO e MOSTRADO: com o DDI —
 * "+55 (67) 99999-9999" (celular, com o 9) ou "+55 (67) 3321-8101" (fixo).
 * Pedido explícito: número do Brasil aparece sempre com o DDI e o 9.
 */
export function formatBrazilianDisplay(national: string): string {
  return `+55 ${formatBrazilianMask(national)}`;
}

/** "+351 968 203 610" / "+1 (917) 555-1234" — agrupamento simples, sem regra por país. */
export function formatInternationalDisplay(ddi: string, national: string): string {
  if (ddi === "1" && national.length === 10) {
    return `+1 (${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
  }
  let grouped: string;
  if (national.length <= 4) grouped = national;
  else if (national.length === 8) grouped = `${national.slice(0, 4)} ${national.slice(4)}`;
  else if (national.length <= 6) grouped = `${national.slice(0, 3)} ${national.slice(3)}`;
  else grouped = `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
  return `+${ddi} ${grouped}`;
}

/**
 * Valida e formata UM telefone. `ctx`:
 *  - "whatsapp": rigoroso — precisa ser um número que recebe WhatsApp:
 *    celular brasileiro, ou número internacional com "+DDI". Fixo e número
 *    sem DDD são recusados.
 *  - "phone" (Celular): mais tranquilo — mesmas máscaras quando o número é
 *    reconhecível (inclusive fixo), mas aceita o que não dá pra interpretar
 *    (ex.: sem DDD) desde que sejam 7 a 15 dígitos; só recusa o que claramente
 *    não é telefone (letras, símbolos, notação científica).
 * Nos dois: número do Brasil sai com o DDI ("+55 (67) 99999-9999") e o
 * celular antigo sem o 9º dígito ganha o 9.
 */
export function parsePhone(raw: string | null | undefined, ctx: PhoneContext): PhoneParseResult {
  const cleaned = cleanPhoneText(raw);
  if (!cleaned) return { ok: true, phone: null };

  const shape = parsePhoneShape(cleaned);

  if (shape.ok && shape.kind === "INTERNATIONAL") {
    const normalized = shape.ddi + shape.national;
    return {
      ok: true,
      phone: {
        kind: "INTERNATIONAL",
        ddi: shape.ddi,
        normalized,
        display: formatInternationalDisplay(shape.ddi, shape.national),
        e164: normalized,
        ninthDigitAdded: false,
      },
    };
  }

  if (shape.ok) {
    let national = shape.national;
    let ninthDigitAdded = false;
    if (ctx === "whatsapp" && shape.kind === "BR_LANDLINE") {
      return { ok: false, code: "LANDLINE_NOT_WHATSAPP", message: phoneErrorMessage({ ok: false, code: "LANDLINE_NOT_WHATSAPP" }) };
    }
    // Celular antigo sem o 9 (10 dígitos, 6-9 depois do DDD) ganha o 9 nos
    // DOIS campos — a regra do plano de numeração é inequívoca (fixo começa
    // com 2-5, então nada de 6-9 é fixo), e o número exibido/gravado tem que
    // ser o mesmo que o WhatsApp entrega.
    if (shape.kind === "BR_MOBILE_NO9") {
      national = national.slice(0, 2) + "9" + national.slice(2);
      ninthDigitAdded = true;
    }
    return {
      ok: true,
      phone: {
        kind: shape.kind === "BR_LANDLINE" ? "BR_LANDLINE" : "BR_MOBILE",
        ddi: "55",
        normalized: national,
        display: formatBrazilianDisplay(national),
        e164: `55${national}`,
        ninthDigitAdded,
      },
    };
  }

  // Não deu pra interpretar.
  if (ctx === "whatsapp" || shape.code === "INVALID_CHARS" || shape.code === "SCIENTIFIC_NOTATION") {
    return { ok: false, code: shape.code, message: phoneErrorMessage(shape) };
  }
  // Celular: aceita o que não é reconhecível se tiver tamanho de telefone.
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 7) return { ok: false, code: "TOO_SHORT", message: "Número muito curto (mínimo 7 dígitos)." };
  if (digits.length > 15) return { ok: false, code: "TOO_LONG", message: "Número com dígitos demais (máximo 15)." };
  return {
    ok: true,
    phone: { kind: "OTHER", ddi: null, normalized: normalizePhoneNumber(cleaned) ?? digits, display: cleaned, e164: null, ninthDigitAdded: false },
  };
}

/** Mensagem de erro pra mostrar no campo, ou null se o valor é aceito (vazio é aceito). */
export function validatePhoneField(raw: string | null | undefined, ctx: PhoneContext): string | null {
  const result = parsePhone(raw, ctx);
  return result.ok ? null : result.message;
}

export type ContactPhoneFields = {
  phone: string | null;
  phoneNormalized: string | null;
  whatsapp: string | null;
  whatsappNormalized: string | null;
};

export type PhoneFieldIssue = { field: "phone" | "whatsapp"; code: PhoneErrorCode; message: string; raw: string };

/**
 * O ÚNICO caminho de gravação de telefone de contato. Recebe o que veio da
 * tela/planilha/API e devolve os 4 campos prontos pro banco (display com
 * máscara + normalizado) e a lista de problemas encontrados.
 *
 * `input.phone` / `input.whatsapp`:
 *  - `undefined` = "não veio nesta chamada" → mantém o valor de `opts.existing`
 *    (edição parcial: mexer só no nome nunca reescreve nem revalida o telefone
 *    que a pessoa nem tocou);
 *  - `null`/"" = apagar o campo;
 *  - texto = limpa, valida e formata (contexto "phone" pro Celular, "whatsapp"
 *    pro WhatsApp — ver parsePhone). Texto inválido NÃO entra: o campo fica
 *    vazio e o problema vai em `issues` (quem chama decide: rejeitar o
 *    cadastro, pular a linha da planilha ou só avisar).
 *
 * `moveMobileToWhatsapp` (padrão true): praticamente todo celular no Brasil
 * também é WhatsApp — contato que fica com Celular preenchido e WhatsApp vazio
 * MUDA o número pro WhatsApp (não copia: o Celular esvazia). Telefone FIXO
 * nunca muda de campo (fixo não recebe WhatsApp). Cadastro manual, edição,
 * importação de contatos e API externa usam o padrão; a importação de
 * NEGÓCIOS desliga (lá o Celular é de propósito o "número 2/backup", só o
 * WhatsApp identifica o contato — ver lib/deals/import-resolve.ts).
 */
export function resolveContactPhones(
  input: { phone?: string | null; whatsapp?: string | null },
  opts: { existing?: ContactPhoneFields | null; moveMobileToWhatsapp?: boolean } = {},
): ContactPhoneFields & { issues: PhoneFieldIssue[]; moved: boolean } {
  const { existing, moveMobileToWhatsapp = true } = opts;
  const issues: PhoneFieldIssue[] = [];

  let phone: string | null = null;
  let phoneNormalized: string | null = null;
  let whatsapp: string | null = null;
  let whatsappNormalized: string | null = null;

  if (input.phone === undefined) {
    phone = existing?.phone ?? null;
    phoneNormalized = existing?.phoneNormalized ?? null;
  } else {
    const r = parsePhone(input.phone, "phone");
    if (!r.ok) issues.push({ field: "phone", code: r.code, message: r.message, raw: String(input.phone) });
    else if (r.phone) {
      phone = r.phone.display;
      phoneNormalized = r.phone.normalized;
    }
  }

  if (input.whatsapp === undefined) {
    whatsapp = existing?.whatsapp ?? null;
    whatsappNormalized = existing?.whatsappNormalized ?? null;
  } else {
    const r = parsePhone(input.whatsapp, "whatsapp");
    if (!r.ok) issues.push({ field: "whatsapp", code: r.code, message: r.message, raw: String(input.whatsapp) });
    else if (r.phone) {
      whatsapp = r.phone.display;
      whatsappNormalized = r.phone.normalized;
    }
  }

  let moved = false;
  if (moveMobileToWhatsapp && !whatsappNormalized && phone) {
    // Reavalia o Celular como WhatsApp: celular (ou internacional) vira
    // WhatsApp já com máscara e 9º dígito; fixo/irreconhecível fica onde está.
    const r = parsePhone(phone, "whatsapp");
    if (r.ok && r.phone) {
      whatsapp = r.phone.display;
      whatsappNormalized = r.phone.normalized;
      phone = null;
      phoneNormalized = null;
      moved = true;
    }
  }

  return { phone, phoneNormalized, whatsapp, whatsappNormalized, issues, moved };
}
