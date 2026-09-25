/**
 * Auditoria SOMENTE LEITURA dos telefones de contato — roda quando quiser
 * (é a checagem de "nunca apóstrofo / tudo com máscara"):
 *
 *   npx tsx --env-file=.env scripts/audit-contact-phones.ts
 *   npx tsx --env-file=.env scripts/audit-contact-phones.ts --csv
 *   npx tsx --env-file=.env scripts/audit-contact-phones.ts --compare .scratch/phone-backups/contacts-phones-full-<data>.json
 *
 * Sem flags: invariantes (têm que dar 0) + censo de formato + números que
 * NÃO passam na validação atual. --csv grava a lista pra revisão em
 * .scratch/phone-backups/ (fora do git). --compare <snapshot> confere o
 * estado atual contra um snapshot antigo: o número NORMALIZADO (a chave única
 * do contato) não pode ter mudado em ninguém — só o texto de exibição.
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ensureBrazilianMobileNinthDigit, normalizePhoneNumber, parsePhone } from "@/lib/phone-normalize";

const ORG_ID = "cmr9i96330001ekvpb3b4o4nn"; // Reobote Consorcios
const WRITE_CSV = process.argv.includes("--csv");
const cmpIdx = process.argv.indexOf("--compare");
const COMPARE_FILE = cmpIdx >= 0 ? process.argv[cmpIdx + 1] : null;

type Snap = { id: string; phone: string | null; whatsapp: string | null; phoneNormalized: string | null; whatsappNormalized: string | null };

const QUOTES = /['\u2018\u2019\u201A\u201B\u2032\u00B4\u0060"\u201C\u201D\u201E\u201F\u2033]/;
/** Brasil COM DDI — a forma canônica: "+55 (67) 99999-9999". */
const BR_WITH_DDI = /^\+55 \(\d{2}\) \d{4,5}-\d{4}$/;
/** Brasil SEM DDI — o formato anterior, ainda a regravar: "(67) 99999-9999". */
const BR_NO_DDI = /^\(\d{2}\) \d{4,5}-\d{4}$/;
const csvCell = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;

async function main() {
  await runWithTenant(ORG_ID, async () => {
    const rows = await prisma.contact.findMany({
      where: { organizationId: ORG_ID },
      select: { id: true, name: true, phone: true, whatsapp: true, phoneNormalized: true, whatsappNormalized: true },
    });
    console.log(`Contatos: ${rows.length}\n`);

    // ── invariantes (todas precisam ser 0) ──
    const withQuote = rows.filter((r) => QUOTES.test(r.whatsapp ?? "") || QUOTES.test(r.phone ?? ""));
    const waNotDigitsNorm = rows.filter((r) => r.whatsappNormalized && /\D/.test(r.whatsappNormalized));
    const phNotDigitsNorm = rows.filter((r) => r.phoneNormalized && /\D/.test(r.phoneNormalized));
    // display e normalizado precisam concordar — exceto que o texto pode MOSTRAR o 9º dígito de um celular
    // antigo cuja chave (única) ficou com 10 dígitos porque o número com 9 já existe em outro contato.
    const agrees = (display: string, normalized: string) => {
      const d = normalizePhoneNumber(display);
      return d === normalized || d === ensureBrazilianMobileNinthDigit(normalized);
    };
    const waMismatch = rows.filter((r) => r.whatsapp && r.whatsappNormalized && !agrees(r.whatsapp, r.whatsappNormalized));
    const phMismatch = rows.filter((r) => r.phone && r.phoneNormalized && !agrees(r.phone, r.phoneNormalized));
    console.log("INVARIANTES (esperado 0):");
    console.log(`  phone/whatsapp com apóstrofo ou aspas: ${withQuote.length}`);
    console.log(`  whatsappNormalized com não-dígito:      ${waNotDigitsNorm.length}`);
    console.log(`  phoneNormalized com não-dígito:         ${phNotDigitsNorm.length}`);
    console.log(`  whatsapp que NÃO re-normaliza pro whatsappNormalized: ${waMismatch.length}`);
    console.log(`  phone que NÃO re-normaliza pro phoneNormalized:       ${phMismatch.length}`);

    // ── censo de formato (WhatsApp e Celular) ──
    const census = (pick: (r: (typeof rows)[number]) => string | null) => {
      let withDdi = 0, noDdi = 0, intl = 0, other = 0, empty = 0;
      for (const r of rows) {
        const v = pick(r);
        if (!v) empty++;
        else if (BR_WITH_DDI.test(v)) withDdi++;
        else if (BR_NO_DDI.test(v)) noDdi++;
        else if (/^\+(?!55 )\d{1,3}/.test(v)) intl++;
        else other++;
      }
      return { withDdi, noDdi, intl, other, empty };
    };
    for (const [label, pick] of [["WHATSAPP", (r: (typeof rows)[number]) => r.whatsapp], ["CELULAR", (r: (typeof rows)[number]) => r.phone]] as const) {
      const c = census(pick);
      console.log(`\nFORMATO DO ${label}:`);
      console.log(`  Brasil COM DDI  +55 (DD) NNNNN-NNNN:    ${c.withDdi}`);
      console.log(`  Brasil sem DDI  (DD) NNNNN-NNNN:        ${c.noDdi}   (a regravar com fix-contact-phones.ts)`);
      console.log(`  internacional   +DDI …:                 ${c.intl}`);
      console.log(`  fora do padrão (legado):                ${c.other}`);
      console.log(`  vazio:                                  ${c.empty}`);
    }

    // ── celular brasileiro antigo sem o 9 (10 dígitos, 6-9 depois do DDD) ──
    const noNinth = (n: string | null) => !!n && /^\d{2}[6-9]\d{7}$/.test(n) && ensureBrazilianMobileNinthDigit(n) !== n;
    const waNoNinth = rows.filter((r) => noNinth(r.whatsappNormalized));
    const phNoNinth = rows.filter((r) => noNinth(r.phoneNormalized));
    console.log("\nCELULAR ANTIGO SEM O 9 NA CHAVE (10 dígitos, 6-9 depois do DDD):");
    console.log(`  whatsappNormalized: ${waNoNinth.length}   phoneNormalized: ${phNoNinth.length}   (o texto já MOSTRA o 9; a chave só muda se não colidir com outro contato)`);

    // ── o que NÃO passa na validação de hoje ──
    const bad = new Map<string, { id: string; name: string; whatsapp: string | null; phone: string | null; message: string }[]>();
    for (const r of rows) {
      if (r.whatsapp) {
        const res = parsePhone(r.whatsapp, "whatsapp");
        if (!res.ok) {
          const list = bad.get(`WhatsApp — ${res.code}`) ?? [];
          list.push({ id: r.id, name: r.name, whatsapp: r.whatsapp, phone: r.phone, message: res.message });
          bad.set(`WhatsApp — ${res.code}`, list);
        }
      }
      if (r.phone) {
        const res = parsePhone(r.phone, "phone");
        if (!res.ok) {
          const list = bad.get(`Celular — ${res.code}`) ?? [];
          list.push({ id: r.id, name: r.name, whatsapp: r.whatsapp, phone: r.phone, message: res.message });
          bad.set(`Celular — ${res.code}`, list);
        }
      }
    }
    console.log("\nNÚMEROS QUE NÃO PASSAM NA VALIDAÇÃO ATUAL (legado — nada foi apagado):");
    let totalBad = 0;
    for (const [k, v] of [...bad.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${String(v.length).padStart(6)}  ${k}`);
      totalBad += v.length;
    }
    console.log(`  ${String(totalBad).padStart(6)}  (total de ocorrências)`);

    if (WRITE_CSV) {
      const dir = path.join(process.cwd(), ".scratch", "phone-backups");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `numeros-para-revisar-${new Date().toISOString().slice(0, 10)}.csv`);
      const lines = ["Motivo;Contato;Id;WhatsApp;Celular;Explicacao"];
      for (const [k, v] of bad) for (const b of v) lines.push([k, b.name, b.id, b.whatsapp, b.phone, b.message].map((x) => csvCell(x)).join(";"));
      fs.writeFileSync(file, String.fromCharCode(0xfeff) + lines.join("\r\n"));
      console.log(`\nLista pra revisão: ${file}`);
    }

    // ── comparação com um snapshot antigo ──
    if (COMPARE_FILE) {
      const snap = JSON.parse(fs.readFileSync(COMPARE_FILE, "utf8")) as Snap[];
      const now = new Map(rows.map((r) => [r.id, r]));
      let sameKey = 0, phoneNormChanged = 0, phoneDisplayChanged = 0, waNormChanged = 0, waDisplayChanged = 0, gone = 0;
      const waNormChangedSamples: string[] = [];
      for (const s of snap) {
        const c = now.get(s.id);
        if (!c) {
          gone++;
          continue;
        }
        if (c.phoneNormalized !== s.phoneNormalized) phoneNormChanged++;
        if (c.phone !== s.phone) phoneDisplayChanged++;
        if (c.whatsappNormalized !== s.whatsappNormalized) {
          waNormChanged++;
          if (waNormChangedSamples.length < 3) waNormChangedSamples.push(`${s.whatsappNormalized} → ${c.whatsappNormalized}`);
        } else sameKey++;
        if (c.whatsapp !== s.whatsapp) waDisplayChanged++;
      }
      console.log(`\nCOMPARAÇÃO com ${path.basename(COMPARE_FILE)} (${snap.length} contatos no snapshot):`);
      console.log(`  contatos que sumiram desde então:            ${gone}`);
      // Sem "esperado" fixo: cada rodada de correção muda uma coisa diferente (máscara = só texto;
      // 9º dígito = texto + chave; restaurar fixo = chave). Confira contra o que aquela rodada anunciou.
      console.log(`  phoneNormalized (chave do Celular) alterado: ${phoneNormChanged}`);
      console.log(`  phone (texto do Celular) alterado:           ${phoneDisplayChanged}`);
      console.log(`  whatsappNormalized (chave) alterado:         ${waNormChanged}`);
      for (const s of waNormChangedSamples) console.log(`      ex.: ${s}`);
      console.log(`  whatsappNormalized IGUAL ao do snapshot:     ${sameKey}`);
      console.log(`  whatsapp (texto de exibição) alterado:       ${waDisplayChanged}`);
    }
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
