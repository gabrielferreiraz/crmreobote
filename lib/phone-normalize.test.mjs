/**
 * Testes da fonte única de telefone (lib/phone-normalize.ts) e do
 * sanitizeCell (lib/csv-sanitize.ts). Sem dependência nenhuma — o test runner
 * embutido do Node (v24 já roda TypeScript direto):
 *
 *   node --test lib/phone-normalize.test.mjs
 *
 * É .mjs (JS puro) DE PROPÓSITO: importa os módulos .ts pelo nome com extensão
 * (o Node exige), e um .ts fazendo isso só passa no typecheck do projeto com
 * `allowImportingTsExtensions` no tsconfig — .mjs fica fora do include do
 * tsconfig, então o build do Next nunca depende disso por causa de um teste.
 *
 * Os casos vêm de dados REAIS de produção (formatos que já apareceram no
 * banco), não de exemplos inventados.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanPhoneText,
  parsePhone,
  resolveContactPhones,
  validatePhoneField,
  normalizePhoneNumber,
  ensureBrazilianMobileNinthDigit,
  isBrazilianShaped,
  isBrazilianLandline,
  toDialNumber,
  formatBrazilianPhone,
  formatBrazilianDisplay,
  formatPhoneMask,
  applyPhoneMask,
  displayPhone,
  fallbackWhatsappToPhone,
  VALID_BRAZILIAN_DDDS,
} from "./phone-normalize.ts";
import { sanitizeCell } from "./csv-sanitize.ts";

function wa(raw) {
  const r = parsePhone(raw, "whatsapp");
  assert.ok(r.ok, `esperava aceitar "${raw}" como WhatsApp, mas: ${r.ok ? "" : r.message}`);
  assert.ok(r.phone, `"${raw}" não deveria ser vazio`);
  return r.phone;
}
function waError(raw) {
  const r = parsePhone(raw, "whatsapp");
  assert.ok(!r.ok, `esperava recusar "${raw}" como WhatsApp`);
  return r;
}

// ─── O bug original: apóstrofo ───────────────────────────────────────

test("cleanPhoneText tira o apóstrofo que o sanitizeCell/planilha punha", () => {
  assert.equal(cleanPhoneText("'+5567999999999"), "+5567999999999");
  assert.equal(cleanPhoneText("’+5567999999999"), "+5567999999999");
  assert.equal(cleanPhoneText("`+55 67 99999-9999`"), "+55 67 99999-9999");
  assert.equal(cleanPhoneText('"(67) 99999-9999"'), "(67) 99999-9999");
});

test("nenhum caminho devolve apóstrofo/aspas no valor gravado", () => {
  const inputs = ["'+5521969637448", "'5521969637448", "’(67) 99999-9999", "+55 '67' 99999-9999", '="5567999999999"', "'+351 968 203 610"];
  for (const raw of inputs) {
    for (const ctx of ["whatsapp", "phone"]) {
      const r = parsePhone(raw, ctx);
      if (!r.ok || !r.phone) continue;
      assert.ok(!/['"`’‘]/.test(r.phone.display), `display com aspas: ${r.phone.display} (${raw}, ${ctx})`);
      assert.ok(!/['"`’‘]/.test(r.phone.normalized), `normalized com aspas: ${r.phone.normalized}`);
    }
  }
});

test("sanitizeCell não prefixa número de telefone, mas continua barrando fórmula", () => {
  // números: intactos
  assert.equal(sanitizeCell("+5567999999999"), "+5567999999999");
  assert.equal(sanitizeCell("+55 (67) 99999-9999"), "+55 (67) 99999-9999");
  assert.equal(sanitizeCell("+351 968 203 610"), "+351 968 203 610");
  assert.equal(sanitizeCell("+ 5567999815780"), "+ 5567999815780");
  // fórmulas / injeção: continuam prefixadas
  assert.equal(sanitizeCell("=1+1"), "'=1+1");
  assert.equal(sanitizeCell("=cmd|' /C calc'!A0"), "'=cmd|' /C calc'!A0");
  assert.equal(sanitizeCell("+cmd|' /C calc'!A0"), "'+cmd|' /C calc'!A0");
  assert.equal(sanitizeCell("@SUM(1+1)"), "'@SUM(1+1)");
  assert.equal(sanitizeCell("-2+3+cmd|x"), "'-2+3+cmd|x");
  assert.equal(sanitizeCell("+1+1"), "'+1+1");
  assert.equal(sanitizeCell("\t+5567999999999"), "'\t+5567999999999");
  assert.equal(sanitizeCell("\r5567999999999"), "'\r5567999999999");
  // texto comum e não-string
  assert.equal(sanitizeCell("João"), "João");
  assert.equal(sanitizeCell(""), "");
  assert.equal(sanitizeCell(null), null);
  assert.equal(sanitizeCell(undefined), undefined);
});

// ─── Formatos reais encontrados no banco ─────────────────────────────

test("WhatsApp: todos os formatos brasileiros reais viram a mesma máscara (com o DDI +55)", () => {
  const same = [
    "(67) 99999-9999",
    "67999999999",
    "+5567999999999",
    "+55 (67) 99999-9999",
    "+55(67) 99999-9999",
    "+55 67992893659".replace("92893659", "99999999"),
    "55 67 99999-9999",
    "5567999999999",
    "067 99999-9999",
    "0055 67 99999-9999",
    "+ 5567999999999",
    "67 99999-9999",
    "6799999-9999",
    "(67) 999999999",
    "'+5567999999999",
    "5567999999999.0",
    "wa.me/5567999999999",
    "https://wa.me/5567999999999",
    "tel:+5567999999999",
    "＋５５６７９９９９９９９９９", // largura total
    "\u200e+55 67 99999-9999\u200f", // marcas invisíveis do copiar/colar (LRM/RLM)
  ];
  for (const raw of same) {
    const p = wa(raw);
    assert.equal(p.display, "+55 (67) 99999-9999", raw);
    assert.equal(p.normalized, "67999999999", raw);
    assert.equal(p.e164, "5567999999999", raw);
    assert.equal(p.kind, "BR_MOBILE", raw);
  }
});

test("WhatsApp: celular antigo sem o 9 ganha o 9 (e avisa)", () => {
  for (const raw of ["(67) 9134-8842", "6791348842", "+55 67 9134-8842", "(67) 91134884".replace("91134884", "91348842")]) {
    const p = wa(raw);
    assert.equal(p.normalized, "67991348842", raw);
    assert.equal(p.display, "+55 (67) 99134-8842", raw);
    assert.equal(p.ninthDigitAdded, true, raw);
  }
});

test("WhatsApp: telefone FIXO é recusado (e nunca recebe um 9 inventado)", () => {
  const r = waError("(67) 3321-8101");
  assert.equal(!r.ok && r.code, "LANDLINE_NOT_WHATSAPP");
  waError("6733218101");
  waError("+55 11 3456-7890");
  assert.equal(ensureBrazilianMobileNinthDigit("6733218101"), "6733218101");
  assert.equal(ensureBrazilianMobileNinthDigit("1145678901"), "1145678901");
  assert.equal(ensureBrazilianMobileNinthDigit("6791348842"), "67991348842");
  assert.equal(ensureBrazilianMobileNinthDigit("67991348842"), "67991348842");
  assert.equal(ensureBrazilianMobileNinthDigit("4079283440"), "4079283440"); // DDD inexistente
});

test("WhatsApp: números errados são recusados com motivo", () => {
  const cases = [
    ["+55 998217118", "TOO_SHORT"], // +55 com 9 dígitos: faltou o DDD
    ["99821-7118", "TOO_SHORT"],
    ["4079283440", "INVALID_DDD"], // DDD 40 não existe
    ["(53) 196156892", "INVALID_BR_MOBILE"], // 11 dígitos sem 9
    ["5567999999999999", "TOO_LONG"],
    ["351968203610", "TOO_LONG"], // estrangeiro SEM "+" não passa
    ["abc", "INVALID_CHARS"],
    [", 6799 615.", "INVALID_CHARS"],
    ["67 99999-9999 / 67 3333-4444", "INVALID_CHARS"],
    ["5,5E+12", "SCIENTIFIC_NOTATION"],
    ["5.56799E+12", "SCIENTIFIC_NOTATION"],
    ["5567900000000", "SCIENTIFIC_NOTATION"], // 5.5679E+12 já convertido pra número: dígitos perdidos
    ["+999 12345678", "UNKNOWN_DDI"],
  ];
  for (const [raw, code] of cases) {
    const r = waError(raw);
    assert.equal(!r.ok && r.code, code, raw);
    assert.ok(!r.ok && r.message.length > 10, `mensagem vazia para ${raw}`);
  }
});

test("WhatsApp: DDI de outros países é aceito e guardado com o DDI", () => {
  const pt = wa("+351 968 203 610");
  assert.equal(pt.kind, "INTERNATIONAL");
  assert.equal(pt.ddi, "351");
  assert.equal(pt.normalized, "351968203610");
  assert.equal(pt.display, "+351 968 203 610");
  assert.equal(pt.e164, "351968203610");
  assert.equal(wa("+351968203610").display, "+351 968 203 610");
  assert.equal(wa("00351968203610").normalized, "351968203610");

  const us = wa("+1 (917) 555-1234");
  assert.equal(us.normalized, "19175551234");
  assert.equal(us.display, "+1 (917) 555-1234");
  assert.equal(wa("+19175551234").display, "+1 (917) 555-1234");

  assert.equal(wa("+44 7947 984694").normalized, "447947984694");
  assert.equal(wa("+34 612 345 678").normalized, "34612345678");
  assert.equal(wa("+54 9 11 1234-5678").normalized, "5491112345678");
  assert.equal(wa("+595 981 123 456").ddi, "595");

  // EUA com tamanho errado
  waError("+1 917 555 123");
  // Nada de tratar número de fora como brasileiro
  assert.equal(wa("+351 968 203 610").kind, "INTERNATIONAL");
});

test("Celular (phone): mais tranquilo — mascara o que dá, aceita o resto, recusa só lixo", () => {
  const ok = (raw) => {
    const r = parsePhone(raw, "phone");
    assert.ok(r.ok && r.phone, `esperava aceitar "${raw}" no Celular`);
    return r.phone;
  };
  // fixo passa e ganha máscara de 8 dígitos
  assert.equal(ok("6733218101").display, "+55 (67) 3321-8101");
  assert.equal(ok("6733218101").kind, "BR_LANDLINE");
  // celular antigo (6-9 depois do DDD) ganha o 9 também no Celular — fixo (2-5) nunca
  assert.equal(ok("6791348842").normalized, "67991348842");
  assert.equal(ok("6791348842").display, "+55 (67) 99134-8842");
  assert.equal(ok("6791348842").ninthDigitAdded, true);
  assert.equal(ok("6733218101").ninthDigitAdded, false);
  // sem DDD: aceita como veio (sem inventar DDD)
  assert.equal(ok("32951058").normalized, "32951058");
  assert.equal(ok("32951058").kind, "OTHER");
  // lixo: recusa
  assert.ok(!parsePhone("abc", "phone").ok);
  assert.ok(!parsePhone("123", "phone").ok);
  assert.ok(!parsePhone("1".repeat(16), "phone").ok);
  assert.ok(!parsePhone("5,5E+12", "phone").ok);
  // apóstrofo nunca sobra
  assert.equal(ok("'+5567999999999").display, "+55 (67) 99999-9999");
});

test("número 'bonito' digitado COM máscara não é barrado pela regra dos zeros", () => {
  assert.equal(wa("(11) 90000-0000").normalized, "11900000000");
  assert.equal(wa("(12) 92800-0000").normalized, "12928000000");
  assert.equal(wa("+55 (12) 92800-0000").normalized, "12928000000");
});

test("campo vazio nunca é erro", () => {
  for (const raw of [undefined, null, "", "   ", "'", '""']) {
    for (const ctx of ["whatsapp", "phone"]) {
      const r = parsePhone(raw, ctx);
      assert.ok(r.ok && r.phone === null, `"${raw}" deveria ser vazio`);
    }
  }
  assert.equal(validatePhoneField("", "whatsapp"), null);
  assert.equal(validatePhoneField("(67) 99999-9999", "whatsapp"), null);
  assert.ok(validatePhoneField("abc", "whatsapp"));
});

// ─── Propriedade: idempotência e volta ao normalizado ────────────────

test("propriedade: a máscara gerada re-normaliza pro MESMO número e re-parseia idêntica", () => {
  const ddds = [...VALID_BRAZILIAN_DDDS];
  let seed = 12345;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const digits = (n) => Array.from({ length: n }, () => String(rnd(10))).join("");
  let checked = 0;
  for (let i = 0; i < 3000; i++) {
    const ddd = ddds[rnd(ddds.length)];
    const mobile = ddd + "9" + digits(8);
    // dígitos puros terminando em 6+ zeros são tratados como "arredondado pelo Excel" (ver parsePhoneShape)
    if (/0{6,}$/.test(mobile)) continue;
    const p = wa(mobile);
    assert.equal(p.normalized, mobile);
    // volta: normalizar a máscara devolve o mesmo valor
    assert.equal(normalizePhoneNumber(p.display), p.normalized, p.display);
    // idempotência
    const again = wa(p.display);
    assert.equal(again.display, p.display);
    assert.equal(again.normalized, p.normalized);
    // formas equivalentes
    assert.equal(wa(`+55${mobile}`).normalized, mobile);
    assert.equal(wa(`55${mobile}`).normalized, mobile);
    assert.equal(wa(`0${mobile}`).normalized, mobile);
    checked++;
  }
  // internacional: a máscara também volta pro mesmo normalizado
  const foreign = ["+351 968 203 610", "+1 (917) 555-1234", "+44 7947 984694", "+34 612 345 678", "+595 981 123 456", "+54 9 11 1234-5678", "+61 412 345 678"];
  for (const raw of foreign) {
    const p = wa(raw);
    assert.equal(normalizePhoneNumber(p.display), p.normalized, p.display);
    const again = wa(p.display);
    assert.equal(again.display, p.display);
    assert.equal(again.normalized, p.normalized);
  }
  assert.ok(checked > 2900, `só ${checked} de 3000 amostras foram checadas`);
});

// ─── resolveContactPhones ────────────────────────────────────────────

test("resolveContactPhones: celular sozinho vira WhatsApp (e o Celular esvazia)", () => {
  const r = resolveContactPhones({ phone: "'+5567999999999" });
  assert.deepEqual(
    { phone: r.phone, phoneNormalized: r.phoneNormalized, whatsapp: r.whatsapp, whatsappNormalized: r.whatsappNormalized },
    { phone: null, phoneNormalized: null, whatsapp: "+55 (67) 99999-9999", whatsappNormalized: "67999999999" },
  );
  assert.equal(r.moved, true);
  assert.deepEqual(r.issues, []);
});

test("resolveContactPhones: FIXO no Celular fica no Celular (não vira WhatsApp)", () => {
  const r = resolveContactPhones({ phone: "(67) 3321-8101" });
  assert.equal(r.phone, "+55 (67) 3321-8101");
  assert.equal(r.phoneNormalized, "6733218101");
  assert.equal(r.whatsapp, null);
  assert.equal(r.moved, false);
});

test("resolveContactPhones: os dois preenchidos ficam cada um no seu campo", () => {
  const r = resolveContactPhones({ phone: "(67) 3321-8101", whatsapp: "+55 67 9134-8842" });
  assert.equal(r.phone, "+55 (67) 3321-8101");
  assert.equal(r.whatsapp, "+55 (67) 99134-8842");
  assert.equal(r.whatsappNormalized, "67991348842");
});

test("resolveContactPhones: inválido NÃO entra e volta em issues", () => {
  const r = resolveContactPhones({ whatsapp: "abc", phone: "(67) 99999-9999" });
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].field, "whatsapp");
  assert.equal(r.issues[0].raw, "abc");
  assert.equal(r.whatsappNormalized, "67999999999"); // o Celular válido migrou pro WhatsApp vazio
  const r2 = resolveContactPhones({ whatsapp: "(67) 3321-8101" });
  assert.equal(r2.issues[0].code, "LANDLINE_NOT_WHATSAPP");
  assert.equal(r2.whatsapp, null);
});

test("resolveContactPhones: edição parcial (undefined) mantém o que já existe", () => {
  const existing = { phone: "(67) 3321-8101", phoneNormalized: "6733218101", whatsapp: "(67) 99999-9999", whatsappNormalized: "67999999999" };
  const keep = resolveContactPhones({}, { existing });
  assert.equal(keep.phone, existing.phone);
  assert.equal(keep.whatsapp, existing.whatsapp);
  assert.deepEqual(keep.issues, []);
  // mexer só no WhatsApp não revalida (nem reescreve) o Celular legado
  const legacy = { phone: "(67) 32951058", phoneNormalized: "6732951058", whatsapp: null, whatsappNormalized: null };
  const edit = resolveContactPhones({ whatsapp: "(67) 98888-7777" }, { existing: legacy });
  assert.equal(edit.phone, "(67) 32951058");
  assert.equal(edit.whatsappNormalized, "67988887777");
  // apagar de propósito
  const cleared = resolveContactPhones({ whatsapp: "" }, { existing });
  assert.equal(cleared.whatsapp, null);
  assert.equal(cleared.whatsappNormalized, null);
});

test("resolveContactPhones: moveMobileToWhatsapp=false (importação de negócios) mantém o Celular", () => {
  const r = resolveContactPhones({ phone: "(67) 99999-9999" }, { moveMobileToWhatsapp: false });
  assert.equal(r.phone, "+55 (67) 99999-9999");
  assert.equal(r.whatsapp, null);
});

// ─── Discagem / exibição ─────────────────────────────────────────────

test("toDialNumber: Brasil ganha 55, número de fora segue com o próprio DDI", () => {
  assert.equal(toDialNumber("67999999999"), "5567999999999");
  assert.equal(toDialNumber("6791348842"), "5567991348842"); // 9º dígito
  assert.equal(toDialNumber("6733218101"), "556733218101"); // fixo: só o 55, sem inventar 9
  assert.equal(toDialNumber("351968203610"), "351968203610");
  assert.equal(toDialNumber("19175551234"), "19175551234");
  assert.equal(toDialNumber("447947984694"), "447947984694");
  assert.equal(toDialNumber("34612345678"), "34612345678");
  assert.equal(toDialNumber(null), null);
  assert.equal(toDialNumber(""), null);
});

test("isBrazilianShaped / isBrazilianLandline", () => {
  assert.ok(isBrazilianShaped("67999999999"));
  assert.ok(isBrazilianShaped("6733218101"));
  assert.ok(!isBrazilianShaped("19175551234")); // EUA (11 dígitos, 3º dígito != 9)
  assert.ok(!isBrazilianShaped("351968203610"));
  assert.ok(!isBrazilianShaped("53196156892")); // lixo
  assert.ok(isBrazilianLandline("6733218101"));
  assert.ok(!isBrazilianLandline("6791348842"));
  assert.ok(!isBrazilianLandline("67999999999"));
});

test("formatBrazilianPhone / displayPhone não rotulam número de fora como +55", () => {
  assert.equal(formatBrazilianPhone("67999999999"), "+55 (67) 99999-9999");
  assert.equal(formatBrazilianPhone("6733218101"), "+55 (67) 3321-8101");
  // o 9 que faltava aparece (é o número que vai ser discado); fixo nunca ganha o 9
  assert.equal(formatBrazilianPhone("6791348842"), "+55 (67) 99134-8842");
  assert.equal(formatBrazilianPhone("11912345678"), "+55 (11) 91234-5678");
  assert.equal(formatBrazilianPhone("351968203610"), "+351968203610"); // antes: "+55 351968203610"
  assert.equal(displayPhone("+5567999999999"), "+55 (67) 99999-9999");
  assert.equal(displayPhone("67999999999"), "+55 (67) 99999-9999");
  assert.equal(displayPhone("(67) 9134-8842"), "+55 (67) 99134-8842");
  assert.equal(displayPhone("+351 968 203 610"), "+351 968 203 610");
  assert.equal(displayPhone("351968203610"), "+351968203610"); // sem "+": não dá pra agrupar, mas não vira "+55"
  assert.equal(displayPhone(null), null);
});

test("fallbackWhatsappToPhone (API antiga, usada nos scripts) também não move fixo", () => {
  const landline = fallbackWhatsappToPhone("(67) 3321-8101", "6733218101", null, null);
  assert.equal(landline.whatsappNormalized, null);
  assert.equal(landline.phoneNormalized, "6733218101");
  const mobile = fallbackWhatsappToPhone("(67) 99999-9999", "67999999999", null, null);
  assert.equal(mobile.whatsappNormalized, "67999999999");
  assert.equal(mobile.phoneNormalized, null);
});

// ─── Máscara ao vivo (o que aparece enquanto se digita) ──────────────

test("formatPhoneMask: brasileiro sempre com +55, enquanto digita", () => {
  const cases = [
    ["", ""],
    ["6", "+55 (6"],
    ["67", "+55 (67"],
    ["679", "+55 (67) 9"],
    ["6799999", "+55 (67) 9999-9"], // 7 dígitos
    ["6733218101", "+55 (67) 3321-8101"], // fixo, 10 dígitos
    ["67999999999", "+55 (67) 99999-9999"], // celular, 11 dígitos
    ["+", "+"],
    ["+5", "+5"],
    ["+55", "+55"],
    ["+556", "+55 (6"],
    ["+5567999999999", "+55 (67) 99999-9999"],
    ["+55 (67) 99999-9999", "+55 (67) 99999-9999"], // já formatado: igual
    ["5567999999999", "+55 (67) 99999-9999"], // 55 colado (13 dígitos)
    ["556733218101", "+55 (67) 3321-8101"], // 55 colado (12 dígitos)
  ];
  for (const [raw, expected] of cases) assert.equal(formatPhoneMask(raw), expected, JSON.stringify(raw));
});

test("formatPhoneMask: número de outro país fica como foi digitado (sem agrupar)", () => {
  assert.equal(formatPhoneMask("+351968203610"), "+351968203610");
  assert.equal(formatPhoneMask("+1 (917) 555-1234"), "+19175551234");
  assert.equal(formatPhoneMask("+44 7947 984694"), "+447947984694");
  assert.equal(formatPhoneMask("351968203610"), "351968203610"); // 12 dígitos sem "+" e sem 55: como antes, só os dígitos
  assert.equal(formatPhoneMask("+55679999999999"), "+55679999999999"); // dígito sobrando depois do +55: não agrupa
});

test("formatPhoneMask: idempotente e igual à forma GRAVADA quando o número está completo", () => {
  const ddds = [...VALID_BRAZILIAN_DDDS];
  let seed = 987;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed >> 8) % n;
  };
  const digits = (n) => Array.from({ length: n }, () => String(rnd(10))).join("");
  for (let i = 0; i < 2000; i++) {
    const ddd = ddds[rnd(ddds.length)];
    const mobile = ddd + "9" + digits(8);
    const landline = ddd + String(2 + rnd(4)) + digits(7);
    for (const n of [mobile, landline]) {
      if (/0{6,}$/.test(n)) continue;
      const live = formatPhoneMask(n);
      assert.equal(formatPhoneMask(live), live, "idempotência " + n);
      const stored = parsePhone(n, "phone");
      assert.ok(stored.ok && stored.phone, n);
      assert.equal(live, stored.phone.display, "a máscara digitada tem que ser IGUAL ao que é gravado: " + n);
    }
  }
});

test("applyPhoneMask: cursor certo mesmo quando a máscara acrescenta o +55", () => {
  // digitando o 1º dígito: cursor no fim, depois do "+55 (" acrescentado
  let r = applyPhoneMask("6", 1);
  assert.deepEqual(r, { value: "+55 (6", caret: 6 });
  // digitando no fim: com 10 dígitos nacionais a máscara é a de 8 dígitos (4-4) — o traço "pula" ao digitar o 11º —, e o cursor fica no fim
  r = applyPhoneMask("+55 (67) 99999-999", 18);
  assert.equal(r.value, "+55 (67) 9999-9999");
  assert.equal(r.caret, r.value.length);
  r = applyPhoneMask("+55 (67) 9999-99999", 19);
  assert.equal(r.value, "+55 (67) 99999-9999");
  assert.equal(r.caret, r.value.length);
  // apagou um dígito NO MEIO (backspace depois do 2º "9"): o cursor continua no mesmo ponto
  r = applyPhoneMask("+55 (67) 9999-9999", 10);
  assert.equal(r.value, "+55 (67) 9999-9999");
  assert.equal(r.caret, 10);
  // digitou um dígito NO MEIO de um número completo (vira 12 dígitos: não agrupa, mas o cursor fica no lugar)
  r = applyPhoneMask("+55 (67) 989999-9999", 11);
  assert.equal(r.value, "+55679899999999");
  assert.equal(r.value.slice(r.caret).replace(/\D/g, "").length, 8); // mesmos 8 dígitos depois do cursor
  // caret fora do intervalo não quebra
  assert.doesNotThrow(() => applyPhoneMask("67", 99));
  assert.doesNotThrow(() => applyPhoneMask("67", -5));
});

test("formatBrazilianDisplay", () => {
  assert.equal(formatBrazilianDisplay("67999999999"), "+55 (67) 99999-9999");
  assert.equal(formatBrazilianDisplay("6733218101"), "+55 (67) 3321-8101");
});
