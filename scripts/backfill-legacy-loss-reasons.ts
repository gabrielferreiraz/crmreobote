/**
 * Backfill do histórico de "motivo de perda" que a migração do Agendor
 * trouxe só como texto livre (Deal.lostReason, formato "{motivo}: {descrição}"
 * ou só "{motivo}" — ver scripts/agendor/import-negocios.ts) e nunca ficou
 * ligado a um LossReason estruturado, por isso o relatório "Por que
 * perdemos negócios" jogava TUDO em "Sem motivo".
 *
 * Descoberto por inspeção (ver scripts/inspect-legacy-loss-reasons.ts): entre
 * ~100 mil negócios perdidos sem lossReasonId, o texto livre tem só 7
 * prefixos distintos antes do ":" (o resto depois disso é a "Descrição do
 * motivo de perda" do Agendor, texto solto/digitado à mão, com dezenas de
 * variações de capitalização/acentuação — não vira taxonomia, só o prefixo
 * vira). Cada prefixo vira UM LossReason novo, rotulado "{Prefixo} (CRM
 * anterior)", com `selectable: false` — aparece em relatório/filtro/
 * histórico normalmente, mas NUNCA no seletor de "por que esse negócio foi
 * perdido?" pra um negócio marcado como perdido daqui pra frente (ver
 * LossReasonDialog em deal-detail.tsx, que agora só busca selectable: true).
 *
 * UPDATE por padrão de texto (equals/startsWith), não por lista de ids —
 * uma categoria só ("Não Respondeu") tem ~53 mil negócios; um IN com esse
 * tanto de parâmetro estoura o limite do Postgres (mesmo motivo já
 * documentado em app/api/deals/route.ts pra outro caso).
 *
 * Idempotente: reaproveita o LossReason se o label já existir (rodar de
 * novo não duplica), e o UPDATE só pega quem ainda está com
 * lossReasonId: null (negócio já backfilled não é tocado de novo).
 *
 * Uso: npx tsx --env-file=.env scripts/backfill-legacy-loss-reasons.ts
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

const ORG_ID = "cmr9i96330001ekvpb3b4o4nn"; // Reobote Consorcios

// Confirmado por inspeção — são os 7 prefixos reais, nenhum outro apareceu
// nos ~100 mil negócios verificados. Hardcoded (não recalculado a cada
// rodada) de propósito: mais auditável, e a checagem de sobra no fim deste
// script pega qualquer coisa que não bata com nenhum destes.
const LEGACY_REASON_PREFIXES = ["Não Respondeu", "Sem interesse", "Número errado", "Desistência", "Adiou", "Sem número", "PQP"];

async function main() {
  await runWithTenant(ORG_ID, async () => {
    const existing = await prisma.lossReason.findMany({
      where: { organizationId: ORG_ID },
      select: { id: true, label: true, order: true },
    });
    let nextOrder = existing.reduce((max, r) => Math.max(max, r.order), -1) + 1;
    const byLabel = new Map(existing.map((r) => [r.label, r]));

    for (const prefix of LEGACY_REASON_PREFIXES) {
      const label = `${prefix} (CRM anterior)`;
      let reasonId = byLabel.get(label)?.id;

      if (!reasonId) {
        const created = await prisma.lossReason.create({
          data: { organizationId: ORG_ID, label, order: nextOrder, selectable: false },
        });
        reasonId = created.id;
        nextOrder += 1;
        console.log(`Criado "${label}" (order ${created.order})`);
      } else {
        console.log(`Reaproveitando "${label}" já existente`);
      }

      const res = await prisma.deal.updateMany({
        where: {
          organizationId: ORG_ID,
          status: "LOST",
          lossReasonId: null,
          OR: [{ lostReason: prefix }, { lostReason: { startsWith: `${prefix}:` } }],
        },
        data: { lossReasonId: reasonId },
      });
      console.log(`  -> ${res.count} negócios vinculados`);
    }

    // Sobra: negócio perdido, sem lossReasonId, mas COM lostReason (texto
    // livre) que não bateu com nenhum dos 7 prefixos acima — não deveria
    // sobrar nada pela inspeção já feita, mas confirma em vez de assumir.
    const leftover = await prisma.deal.count({
      where: { organizationId: ORG_ID, status: "LOST", lossReasonId: null, lostReason: { not: null } },
    });
    const trulyNoReason = await prisma.deal.count({
      where: { organizationId: ORG_ID, status: "LOST", lossReasonId: null, lostReason: null },
    });
    console.log(`\nSobrou sem bater com nenhum prefixo (tem texto, mas não migrou): ${leftover}`);
    console.log(`Sem motivo nenhum de verdade (nem texto livre) — "Sem motivo" real: ${trulyNoReason}`);
  });
}

main()
  .then(() => {
    console.log("\nConcluído.");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
