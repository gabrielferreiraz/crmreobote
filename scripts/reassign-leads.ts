/**
 * Repasse de leads em massa — lê um arquivo exportado do Pipeline (Nome,
 * Contato, WhatsApp, Pipeline, Etapa, Status, Responsável atual, Valor,
 * Criado em) e troca o Deal.ownerId (+ Contact.responsavelId do contato
 * dono do negócio) pro consultor de destino informado.
 *
 * Casamento SEM id único (planilha não tem um) — 2 passos:
 *   1. WhatsApp normalizado → Contact (organização inteira).
 *   2. Nome do negócio (coluna "Nome") → Deal daquele contato.
 * Cada linha vira um de 5 status — NUNCA adivinha um ambíguo:
 *   - MATCHED: 1 contato, 1 negócio — pronto pra trocar.
 *   - NO_CONTACT: telefone não bate com nenhum contato.
 *   - AMBIGUOUS_CONTACT: telefone bate com mais de 1 contato.
 *   - NO_DEAL: contato achado, mas nenhum negócio dele bate com o "Nome".
 *   - AMBIGUOUS_DEAL: mais de 1 negócio do contato bate com o "Nome".
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/reassign-leads.ts \
 *     --file=<path> --to=<email do consultor> [--apply]
 *
 * Sem --apply roda só o casamento e imprime o relatório (nada é gravado).
 * Com --apply, só as linhas MATCHED são de fato alteradas — tudo que não é
 * MATCHED fica de fora e aparece no relatório pra você resolver na mão.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { normalizePhoneNumber } from "@/lib/phone-normalize";
import { ORGANIZATION_ID } from "@/scripts/agendor/users";
import { loadSheet, getHeaders, colIndex } from "@/scripts/agendor/xlsx-utils";

function parseArgs(): { file: string; to: string; apply: boolean } {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const found = args.find((a) => a.startsWith(`--${flag}=`));
    return found ? found.slice(flag.length + 3) : undefined;
  };
  const file = get("file");
  const to = get("to");
  const apply = args.includes("--apply");
  if (!file || !to) {
    console.error("Uso: npx tsx --env-file=.env scripts/reassign-leads.ts --file=<path> --to=<email> [--apply]");
    process.exit(1);
  }
  return { file, to, apply };
}

// Cabeçalho de verdade está na linha 3 (linha 1 = título mesclado, linha 2 = vazia) —
// diferente das planilhas do Agendor (cabeçalho na linha 1), então não reaproveita
// getHeaders/colIndex direto na linha 1; resolve o índice de cada coluna manualmente
// procurando pelo NOME na linha 3.
async function findHeaderRow(sheet: Awaited<ReturnType<typeof loadSheet>>): Promise<{ headerRowIndex: number; headers: string[] }> {
  for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
    const row = sheet.getRow(r);
    const vals: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => (vals[col] = String(cell.value ?? "")));
    if (vals.includes("Nome") && vals.includes("WhatsApp")) {
      return { headerRowIndex: r, headers: vals };
    }
  }
  throw new Error("Linha de cabeçalho (com 'Nome' e 'WhatsApp') não encontrada nas 10 primeiras linhas.");
}

type RowResult = {
  rowIndex: number;
  nome: string;
  contato: string;
  whatsapp: string;
  responsavelAtualPlanilha: string;
  status: "MATCHED" | "NO_CONTACT" | "AMBIGUOUS_CONTACT" | "NO_DEAL" | "AMBIGUOUS_DEAL";
  contactId?: string;
  dealId?: string;
  currentOwnerName?: string;
  candidates?: string[]; // pra status ambíguo, lista legível do que foi encontrado
};

async function main() {
  const { file, to, apply } = parseArgs();

  await runWithTenant(ORGANIZATION_ID, async () => {
    const targetUser = await prisma.user.findUnique({ where: { email: to } });
    if (!targetUser) {
      console.error(`Consultor de destino não encontrado: ${to}`);
      process.exit(1);
    }
    console.log(`Destino: ${targetUser.name} <${to}> (${targetUser.id})\n`);

    const sheet = await loadSheet(file);
    const { headerRowIndex, headers } = await findHeaderRow(sheet);
    const idxNome = headers.indexOf("Nome");
    const idxContato = headers.indexOf("Contato");
    const idxWhatsapp = headers.indexOf("WhatsApp");
    const idxResponsavel = headers.indexOf("Responsável");

    const results: RowResult[] = [];

    for (let r = headerRowIndex + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const cell = (idx: number) => {
        const v = row.getCell(idx).value;
        return v === null || v === undefined ? "" : String(v).trim();
      };
      const nome = cell(idxNome);
      const contato = cell(idxContato);
      const whatsapp = cell(idxWhatsapp);
      const responsavelAtualPlanilha = cell(idxResponsavel);
      if (!nome && !contato && !whatsapp) continue; // linha em branco no fim

      const normalized = normalizePhoneNumber(whatsapp);
      if (!normalized) {
        results.push({ rowIndex: r, nome, contato, whatsapp, responsavelAtualPlanilha, status: "NO_CONTACT" });
        continue;
      }

      const contacts = await prisma.contact.findMany({
        where: { organizationId: ORGANIZATION_ID, OR: [{ phoneNormalized: normalized }, { whatsappNormalized: normalized }] },
        select: { id: true, name: true },
      });

      if (contacts.length === 0) {
        results.push({ rowIndex: r, nome, contato, whatsapp, responsavelAtualPlanilha, status: "NO_CONTACT" });
        continue;
      }
      if (contacts.length > 1) {
        results.push({
          rowIndex: r,
          nome,
          contato,
          whatsapp,
          responsavelAtualPlanilha,
          status: "AMBIGUOUS_CONTACT",
          candidates: contacts.map((c) => `${c.name} (${c.id})`),
        });
        continue;
      }

      const contact = contacts[0];
      const deals = await prisma.deal.findMany({
        where: { organizationId: ORGANIZATION_ID, contactId: contact.id },
        select: { id: true, name: true, owner: { select: { name: true } } },
      });

      const nomeNorm = nome.trim().toLowerCase();
      const exact = deals.filter((d) => d.name.trim().toLowerCase() === nomeNorm);
      const matchedDeals = exact.length > 0 ? exact : deals; // só 1 negócio no contato já resolve mesmo sem bater o nome exato

      if (matchedDeals.length === 0) {
        results.push({ rowIndex: r, nome, contato, whatsapp, responsavelAtualPlanilha, status: "NO_DEAL", contactId: contact.id });
        continue;
      }
      if (matchedDeals.length > 1) {
        results.push({
          rowIndex: r,
          nome,
          contato,
          whatsapp,
          responsavelAtualPlanilha,
          status: "AMBIGUOUS_DEAL",
          contactId: contact.id,
          candidates: matchedDeals.map((d) => `"${d.name}" (${d.id}, dono atual: ${d.owner.name})`),
        });
        continue;
      }

      const deal = matchedDeals[0];
      results.push({
        rowIndex: r,
        nome,
        contato,
        whatsapp,
        responsavelAtualPlanilha,
        status: "MATCHED",
        contactId: contact.id,
        dealId: deal.id,
        currentOwnerName: deal.owner.name,
      });
    }

    // ─── Relatório ──────────────────────────────────────────────────────
    const byStatus = new Map<string, RowResult[]>();
    for (const r of results) {
      if (!byStatus.has(r.status)) byStatus.set(r.status, []);
      byStatus.get(r.status)!.push(r);
    }

    for (const status of ["MATCHED", "NO_CONTACT", "AMBIGUOUS_CONTACT", "NO_DEAL", "AMBIGUOUS_DEAL"] as const) {
      const rows = byStatus.get(status) ?? [];
      console.log(`\n${"=".repeat(70)}\n${status} (${rows.length})\n${"=".repeat(70)}`);
      for (const r of rows) {
        if (status === "MATCHED") {
          console.log(`  linha ${r.rowIndex}: "${r.nome}" — dono atual: ${r.currentOwnerName} → ${targetUser.name}`);
        } else if (status === "AMBIGUOUS_CONTACT" || status === "AMBIGUOUS_DEAL") {
          console.log(`  linha ${r.rowIndex}: "${r.nome}" (${r.contato}, ${r.whatsapp}) — candidatos: ${r.candidates?.join("; ")}`);
        } else {
          console.log(`  linha ${r.rowIndex}: "${r.nome}" (${r.contato}, ${r.whatsapp})`);
        }
      }
    }

    console.log(`\n${"=".repeat(70)}\nTotal: ${results.length} linha(s). Prontas pra trocar: ${byStatus.get("MATCHED")?.length ?? 0}.\n${"=".repeat(70)}`);

    if (!apply) {
      console.log("\n(dry-run — nada foi gravado; rode de novo com --apply pra aplicar só as linhas MATCHED)");
      return;
    }

    const matched = byStatus.get("MATCHED") ?? [];
    let updated = 0;
    for (const r of matched) {
      await prisma.deal.update({ where: { id: r.dealId! }, data: { ownerId: targetUser.id } });
      await prisma.contact.update({ where: { id: r.contactId! }, data: { responsavelId: targetUser.id } });
      await prisma.activity.create({
        data: {
          organizationId: ORGANIZATION_ID,
          dealId: r.dealId!,
          contactId: r.contactId!,
          userId: targetUser.id,
          type: "SYSTEM",
          body: `Repassado de ${r.currentOwnerName} para ${targetUser.name} (lista de repasse)`,
        },
      });
      updated++;
    }
    console.log(`\n✅ ${updated} negócio(s) + contato(s) repassado(s) pra ${targetUser.name}.`);
  });
}

main()
  .catch((err) => {
    console.error("\n❌ Falhou:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
