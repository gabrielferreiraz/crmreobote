/**
 * Padroniza o texto de exibição dos telefones dos contatos (Contact.whatsapp e
 * Contact.phone): todo número fica no formato com máscara e COM O DDI —
 * "+55 (67) 99999-9999" (Brasil, celular sempre com o 9) ou
 * "+351 968 203 610" (outro país) — e perde apóstrofo/aspas
 * ("'+5567999999999", bug do sanitizeCell, ver lib/csv-sanitize.ts).
 *
 * A máscara é só texto de exibição: nada de busca/duplicidade/conversa muda —
 * a chave (Normalized, única) só é tocada na correção do 9º dígito, abaixo.
 * Fixo (2-5 depois do DDD) nunca ganha o 9. Número ilegível demais pra
 * reformatar fica como está (só perde a aspa, se tiver) e aparece em
 * scripts/audit-contact-phones.ts.
 *
 * O 9º DÍGITO: celular antigo (10 dígitos, 6-9 depois do DDD) ganha o 9 no
 * texto e — quando não colide com outro contato — também na CHAVE. Se o
 * número com 9 já existe em OUTRO contato (duplicata; a chave é única), só o
 * texto passa a mostrar o 9 e a chave fica como está.
 *
 * DOIS MODOS, por causa da ORDEM DE IMPLANTAÇÃO: o texto novo do Brasil começa
 * com "+", e o sanitizeCell ANTIGO (o que ainda roda em produção até o código
 * novo subir) prefixa "'" em tudo que começa com "+" a cada edição de contato.
 *   - SEM --code-deployed (modo seguro, padrão): só faz o que é seguro com o
 *     código antigo — acrescenta o 9º dígito que faltava (texto com "(" na
 *     frente: "(67) 99201-3986") e tira aspa/apóstrofo. NÃO põe o "+55".
 *   - COM --code-deployed: confirma que o código novo (lib/csv-sanitize.ts com
 *     PHONE_LIKE) já está em produção; aí regrava TUDO com o "+55".
 *
 * Idempotente: pode rodar de novo quando quiser (ex.: pra pegar algo que o
 * código antigo tenha gravado enquanto isso).
 *
 * Relatório por padrão (nada é gravado). --apply grava, em lotes, com trava
 * otimista (só atualiza a linha se ela ainda está como foi lida) e ANTES de
 * gravar salva um snapshot completo e o arquivo de alterações em
 * .scratch/phone-backups/ (fora do git) — --rollback <arquivo> desfaz
 * exatamente aquelas linhas.
 *
 *   npx tsx --env-file=.env scripts/fix-contact-phones.ts
 *   npx tsx --env-file=.env scripts/fix-contact-phones.ts --apply                  (modo seguro: 9º dígito + aspas)
 *   npx tsx --env-file=.env scripts/fix-contact-phones.ts --apply --code-deployed  (depois do deploy: tudo com +55)
 *   npx tsx --env-file=.env scripts/fix-contact-phones.ts --rollback .scratch/phone-backups/<arquivo>.json
 *
 * HISTÓRICO (2026-09-25): a primeira rodada deste script também restaurou 850
 * telefones FIXOS que o backfill do 9º dígito (backfill-whatsapp-ninth-digit.ts)
 * transformou em "celular" inventado — "(67) 3321-8101" virou "(67) 93321-8101".
 * Foi executada uma vez (arquivo de alterações
 * .scratch/phone-backups/fix-contact-phones-restore-*.json, reversível com
 * --rollback) e REMOVIDA daqui de propósito: o critério de evidência dela era
 * "o texto está exatamente na máscara que o backfill grava", e a fase de
 * máscara justamente passa a gravar todo mundo nessa máscara — reexecutar
 * aquela fase depois disso restauraria número que nunca foi mexido.
 */
import fs from "node:fs";
import path from "node:path";
import { prisma, prismaRaw } from "@/lib/prisma";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import {
  cleanPhoneText,
  ensureBrazilianMobileNinthDigit,
  formatBrazilianDisplay,
  formatBrazilianMask,
  formatInternationalDisplay,
  normalizePhoneNumber,
  parsePhoneShape,
} from "@/lib/phone-normalize";

const ORG_ID = "cmr9i96330001ekvpb3b4o4nn"; // Reobote Consorcios
const APPLY = process.argv.includes("--apply");
const CODE_DEPLOYED = process.argv.includes("--code-deployed");
const rollbackIdx = process.argv.indexOf("--rollback");
const ROLLBACK_FILE = rollbackIdx >= 0 ? process.argv[rollbackIdx + 1] : null;
const BATCH = 2000;
const PAUSE_MS = 300;
const BACKUP_DIR = path.join(process.cwd(), ".scratch", "phone-backups");

type Field = "whatsapp" | "phone";
type Row = { id: string; phone: string | null; whatsapp: string | null; whatsappNormalized: string | null; phoneNormalized: string | null };
/** `field` ausente = entrada antiga (só WhatsApp) de uma rodada anterior deste script. */
type Change = {
  id: string;
  field?: Field;
  phase: string;
  before: { whatsapp: string | null; whatsappNormalized: string | null };
  after: { whatsapp: string; whatsappNormalized: string };
};
type Update = { id: string; oldDisplay: string | null; oldNorm: string | null; newDisplay: string; newNorm: string };

const QUOTE_LIKE = /['\u2018\u2019\u201A\u201B\u2032\u00B4\u0060"\u201C\u201D\u201E\u201F\u2033]/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Grava um lote de WhatsApp com trava otimista — só muda a linha se ela ainda está como foi lida. Devolve quantas mudaram. */
async function updateWhatsappBatch(batch: Update[]): Promise<number> {
  return prismaRaw.$transaction(
    async (tx) => {
      await setTenantOnTx(tx, ORG_ID);
      return tx.$executeRaw`
        UPDATE "Contact" AS c
        SET "whatsapp" = v.new_d, "whatsappNormalized" = v.new_n
        FROM unnest(${batch.map((b) => b.id)}::text[], ${batch.map((b) => b.oldDisplay)}::text[], ${batch.map((b) => b.oldNorm)}::text[],
                    ${batch.map((b) => b.newDisplay)}::text[], ${batch.map((b) => b.newNorm)}::text[]) AS v(id, old_d, old_n, new_d, new_n)
        WHERE c.id = v.id
          AND c."organizationId" = ${ORG_ID}
          AND c."whatsapp" IS NOT DISTINCT FROM v.old_d
          AND c."whatsappNormalized" IS NOT DISTINCT FROM v.old_n`;
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}

/** Mesma coisa pro Celular (phone/phoneNormalized). */
async function updatePhoneBatch(batch: Update[]): Promise<number> {
  return prismaRaw.$transaction(
    async (tx) => {
      await setTenantOnTx(tx, ORG_ID);
      return tx.$executeRaw`
        UPDATE "Contact" AS c
        SET "phone" = v.new_d, "phoneNormalized" = v.new_n
        FROM unnest(${batch.map((b) => b.id)}::text[], ${batch.map((b) => b.oldDisplay)}::text[], ${batch.map((b) => b.oldNorm)}::text[],
                    ${batch.map((b) => b.newDisplay)}::text[], ${batch.map((b) => b.newNorm)}::text[]) AS v(id, old_d, old_n, new_d, new_n)
        WHERE c.id = v.id
          AND c."organizationId" = ${ORG_ID}
          AND c."phone" IS NOT DISTINCT FROM v.old_d
          AND c."phoneNormalized" IS NOT DISTINCT FROM v.old_n`;
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}

const updateFor = (field: Field, batch: Update[]) => (field === "phone" ? updatePhoneBatch(batch) : updateWhatsappBatch(batch));

async function rollback(file: string) {
  const changes = JSON.parse(fs.readFileSync(file, "utf8")) as Change[];
  console.log(`Revertendo ${changes.length} alterações de ${file}...`);
  let reverted = 0;
  for (const field of ["whatsapp", "phone"] as const) {
    const ofField = changes.filter((c) => (c.field ?? "whatsapp") === field);
    for (let i = 0; i < ofField.length; i += BATCH) {
      const slice = ofField.slice(i, i + BATCH);
      // Volta ao "before" só se a linha ainda está no "after" (ninguém mexeu depois).
      const n = await updateFor(
        field,
        slice.map((c) => ({ id: c.id, oldDisplay: c.after.whatsapp, oldNorm: c.after.whatsappNormalized, newDisplay: c.before.whatsapp ?? "", newNorm: c.before.whatsappNormalized ?? "" })),
      );
      reverted += n;
      console.log(`  [${field}] ${Math.min(i + BATCH, ofField.length)}/${ofField.length} — revertidas neste lote: ${n}`);
      await sleep(PAUSE_MS);
    }
  }
  console.log(`Concluído: ${reverted} de ${changes.length} revertidas (as demais foram alteradas depois e ficaram como estão).`);
}

/**
 * A forma canônica do texto de um número já salvo, ou null se ele é ilegível
 * demais pra reformatar. Só devolve algo quando o número que o texto diz é o
 * MESMO que a chave gravada (ou a chave com o 9 acrescentado, no caso do
 * celular antigo) — nunca reformata um texto que diverge da chave.
 */
function canonicalDisplay(display: string, normalized: string | null, withDdi: boolean): { display: string; ninthShown: boolean } | null {
  const shape = parsePhoneShape(cleanPhoneText(display));
  if (!shape.ok) return null;

  let national = shape.national;
  let ninthShown = false;
  if (shape.kind === "BR_MOBILE_NO9") {
    national = national.slice(0, 2) + "9" + national.slice(2);
    ninthShown = true;
  }
  const digitsSaid = shape.kind === "INTERNATIONAL" ? shape.ddi + national : national;
  // withDdi=false (modo seguro): brasileiro só com a máscara nacional "(67) 99999-9999", que começa com "(" e
  // o código antigo em produção não estraga; com o DDI ("+55 …") só depois do deploy.
  const canonical =
    shape.kind === "INTERNATIONAL"
      ? formatInternationalDisplay(shape.ddi, shape.national)
      : withDdi
        ? formatBrazilianDisplay(national)
        : formatBrazilianMask(national);

  // Invariante: a chave gravada (única) é EXATAMENTE o que o texto diz — ou, no celular antigo sem o 9, o que o texto diz sem o 9.
  if (!normalized) return null;
  if (digitsSaid !== normalized && digitsSaid !== ensureBrazilianMobileNinthDigit(normalized)) return null;
  if (normalizePhoneNumber(canonical) !== digitsSaid) return null;
  return { display: canonical, ninthShown };
}

async function main() {
  if (ROLLBACK_FILE) {
    await rollback(ROLLBACK_FILE);
    return;
  }

  await runWithTenant(ORG_ID, async () => {
    const rows: Row[] = await prisma.contact.findMany({
      where: { organizationId: ORG_ID },
      select: { id: true, phone: true, whatsapp: true, phoneNormalized: true, whatsappNormalized: true },
    });
    console.log(`Contatos lidos: ${rows.length}`);

    const changes: Change[] = [];
    const skippedReasons = new Map<string, number>();
    const skip = (why: string) => skippedReasons.set(why, (skippedReasons.get(why) ?? 0) + 1);
    const already = { whatsapp: 0, phone: 0 };
    let pendingDdi = 0; // modo seguro: quantos ainda ganhariam o "+55" depois do deploy

    // Chaves já em uso (por coluna) — pra saber se corrigir o 9 da chave colidiria com outro contato.
    const takenKeys: Record<Field, Set<string>> = {
      whatsapp: new Set(rows.map((r) => r.whatsappNormalized).filter((v): v is string => !!v)),
      phone: new Set(rows.map((r) => r.phoneNormalized).filter((v): v is string => !!v)),
    };
    type Ninth = { id: string; field: Field; display: string; normalized: string; target: string; fixedKey: string };
    const ninth: Ninth[] = [];

    for (const r of rows) {
      for (const field of ["whatsapp", "phone"] as const) {
        const display = field === "whatsapp" ? r.whatsapp : r.phone;
        const normalized = field === "whatsapp" ? r.whatsappNormalized : r.phoneNormalized;
        if (!display) continue;

        const canon = canonicalDisplay(display, normalized, CODE_DEPLOYED);
        if (!canon) {
          // Ilegível/divergente — mas aspa/apóstrofo NUNCA tem motivo de ficar: tira só isso (a chave não pode mudar).
          if (QUOTE_LIKE.test(display)) {
            const cleaned = cleanPhoneText(display);
            if (cleaned && cleaned !== display && normalizePhoneNumber(cleaned) === normalized) {
              changes.push({ id: r.id, field, phase: "quotes", before: { whatsapp: display, whatsappNormalized: normalized }, after: { whatsapp: cleaned, whatsappNormalized: normalized! } });
              continue;
            }
          }
          skip(`${field}: texto ilegível ou diverge da chave (não mexi)`);
          continue;
        }

        // Celular antigo sem o 9 NA CHAVE (10 dígitos, 6-9 depois do DDD)? Trata à parte (texto + chave).
        const fixedKey = normalized ? ensureBrazilianMobileNinthDigit(normalized) : null;
        if (normalized && fixedKey && fixedKey !== normalized) {
          ninth.push({ id: r.id, field, display, normalized, target: canon.display, fixedKey });
          continue;
        }

        // Modo seguro: o resto (só falta o "+55") espera o deploy.
        if (!CODE_DEPLOYED) {
          const withDdi = canonicalDisplay(display, normalized, true);
          if (withDdi && withDdi.display !== display) pendingDdi++;
          else already[field]++;
          continue;
        }
        if (canon.display === display) {
          already[field]++;
          continue;
        }
        changes.push({ id: r.id, field, phase: "ddi", before: { whatsapp: display, whatsappNormalized: normalized }, after: { whatsapp: canon.display, whatsappNormalized: normalized! } });
      }
    }

    // 9º dígito: corrige a CHAVE junto quando o número com 9 ainda não existe em outro contato (nem em outro candidato desta rodada).
    const claims = new Map<string, number>();
    for (const n of ninth) claims.set(`${n.field}:${n.fixedKey}`, (claims.get(`${n.field}:${n.fixedKey}`) ?? 0) + 1);
    let ninthKey = 0;
    let ninthDisplayOnly = 0;
    for (const n of ninth) {
      const collides = takenKeys[n.field].has(n.fixedKey) || (claims.get(`${n.field}:${n.fixedKey}`) ?? 0) > 1;
      const newNorm = collides ? n.normalized : n.fixedKey;
      if (newNorm === n.normalized && n.target === n.display) {
        already[n.field]++;
        continue;
      }
      if (collides) ninthDisplayOnly++;
      else ninthKey++;
      changes.push({
        id: n.id,
        field: n.field,
        phase: collides ? "ninth-display" : "ninth-key",
        before: { whatsapp: n.display, whatsappNormalized: n.normalized },
        after: { whatsapp: n.target, whatsappNormalized: newNorm },
      });
    }

    const byField = (f: Field) => changes.filter((c) => c.field === f);
    const withQuote = changes.filter((c) => QUOTE_LIKE.test(c.before.whatsapp ?? ""));
    // Vira "+…" o que antes não era? É isso que o código ANTIGO em produção estragaria (ver ORDEM DE IMPLANTAÇÃO).
    const becomesPlus = changes.filter((c) => c.after.whatsapp.startsWith("+") && !(c.before.whatsapp ?? "").trimStart().startsWith("+"));

    console.log("\n=== RELATÓRIO ===");
    console.log(`WhatsApp a padronizar: ${byField("whatsapp").length}   |   Celular a padronizar: ${byField("phone").length}`);
    console.log(`  já corretos: WhatsApp ${already.whatsapp}, Celular ${already.phone}`);
    console.log(`  9º dígito que faltava (celular antigo de 10 dígitos): chave corrigida junto = ${ninthKey}; só o texto (o número com 9 já existe em outro contato) = ${ninthDisplayOnly}`);
    console.log(`  com apóstrofo/aspas a remover: ${withQuote.length}`);
    if (!CODE_DEPLOYED) console.log(`  MODO SEGURO — ainda faltam receber o "+55" (só depois do deploy, com --code-deployed): ${pendingDdi}`);
    else console.log(`  passam a começar com "+": ${becomesPlus.length}`);
    for (const [why, n] of [...skippedReasons.entries()].sort((a, b) => b[1] - a[1])) console.log(`  não alterados — ${why}: ${n}`);
    console.log("\nAmostras:");
    for (const c of changes.filter((x) => !x.phase.startsWith("ninth")).slice(0, 4)) console.log(`  [${c.field}] ${JSON.stringify(c.before.whatsapp)} → ${JSON.stringify(c.after.whatsapp)}`);
    for (const c of changes.filter((x) => x.phase.startsWith("ninth")).slice(0, 6)) {
      console.log(`  [${c.field}] (9º dígito, ${c.phase}) ${JSON.stringify(c.before.whatsapp)} → ${JSON.stringify(c.after.whatsapp)}   chave ${c.before.whatsappNormalized} → ${c.after.whatsappNormalized}`);
    }

    if (!APPLY) {
      console.log("\n[relatório apenas — nada foi gravado]");
      if (!CODE_DEPLOYED) console.log("Modo seguro: --apply grava só o 9º dígito e a limpeza de aspas. O +55 fica pra depois do deploy (--apply --code-deployed).");
      return;
    }
    // Defesa em profundidade: no modo seguro nada pode virar "+…" (o código antigo prefixaria "'" a cada edição).
    if (becomesPlus.length > 0 && !CODE_DEPLOYED) {
      console.error(
        `\nRECUSADO (defesa em profundidade): ${becomesPlus.length} números passariam a começar com "+", e o código ANTIGO em produção prefixa um apóstrofo em todo texto que começa com "+" a cada edição de contato.\n` +
          `Suba o código novo (commit + push + deploy) e só então rode:  --apply --code-deployed`,
      );
      process.exitCode = 1;
      return;
    }
    if (changes.length === 0) {
      console.log("\nNada a gravar.");
      return;
    }

    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    // 1) snapshot COMPLETO dos 4 campos de telefone de todo contato (segunda
    //    rede de segurança, independente do arquivo de alterações abaixo);
    const fullFile = path.join(BACKUP_DIR, `contacts-phones-full-${stamp}.json`);
    fs.writeFileSync(fullFile, JSON.stringify(rows));
    // 2) só as linhas que este script vai mudar, com antes/depois — é o que o --rollback lê.
    const logFile = path.join(BACKUP_DIR, `fix-contact-phones-${CODE_DEPLOYED ? "ddi" : "ninth"}-${stamp}.json`);
    fs.writeFileSync(logFile, JSON.stringify(changes));
    console.log(`\nSnapshot completo: ${fullFile}`);
    console.log(`Arquivo de alterações (pra reverter com --rollback): ${logFile}`);
    console.log(`Aplicando ${changes.length} alterações...`);

    let done = 0;
    let conflicts = 0;
    for (const field of ["whatsapp", "phone"] as const) {
      const list = byField(field);
      for (let i = 0; i < list.length; i += BATCH) {
        const slice = list.slice(i, i + BATCH);
        const n = await updateFor(
          field,
          slice.map((c) => ({ id: c.id, oldDisplay: c.before.whatsapp, oldNorm: c.before.whatsappNormalized, newDisplay: c.after.whatsapp, newNorm: c.after.whatsappNormalized })),
        );
        done += n;
        conflicts += slice.length - n;
        console.log(`  [${field}] ${Math.min(i + BATCH, list.length)}/${list.length} — gravadas neste lote: ${n}`);
        await sleep(PAUSE_MS);
      }
    }
    console.log(`\nConcluído: ${done} gravadas; ${conflicts} puladas porque a linha mudou desde a leitura.`);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
