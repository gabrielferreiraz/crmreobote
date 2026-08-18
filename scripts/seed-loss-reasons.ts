/**
 * Adiciona os motivos de perda pedidos pelo usuário — lista fechada de 10 +
 * "PQP" (pedido à parte, mesmo espírito de humor interno, sem elaborar).
 * Idempotente: pula qualquer label que já exista na organização (comparação
 * exata), então rodar de novo não duplica nada. Continua a numeração de
 * `order` a partir do maior já existente, em vez de assumir organização
 * vazia — preserva a ordem pedida (1 a 10, PQP por último) como sequência
 * relativa entre os novos, não como valor absoluto de `order`.
 *
 * "Outro" aqui é só o rótulo — o comportamento de "campo de texto
 * obrigatório quando esse motivo for escolhido" é tratado à parte, em
 * app/(dashboard)/negocios/[id]/deal-detail.tsx (LossReasonDialog), não é
 * algo que dá pra representar só com uma linha na tabela LossReason.
 *
 * Uso: npx tsx --env-file=.env scripts/seed-loss-reasons.ts
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

const ORG_ID = "cmr9i96330001ekvpb3b4o4nn"; // Reobote Consorcios — mesmo id de scripts/factory-reset-reobote.ts

const LABELS = [
  "Sem capacidade financeira",
  "Parcela incompatível",
  "Prazo incompatível com urgência do cliente",
  "Adiou a decisão",
  "Escolheu concorrente",
  "Falta de interesse real (lead mal qualificado)",
  "Não respondeu (silêncio)",
  "Mudança de objetivo",
  "Perfil inadequado ao produto",
  "Outro",
  "PQP",
];

async function main() {
  await runWithTenant(ORG_ID, async () => {
    const existing = await prisma.lossReason.findMany({
      where: { organizationId: ORG_ID },
      select: { label: true, order: true },
    });
    const existingLabels = new Set(existing.map((r) => r.label));
    let nextOrder = existing.reduce((max, r) => Math.max(max, r.order), -1) + 1;

    for (const label of LABELS) {
      if (existingLabels.has(label)) {
        console.log(`  já existe, pulando: "${label}"`);
        continue;
      }
      await prisma.lossReason.create({ data: { organizationId: ORG_ID, label, order: nextOrder } });
      console.log(`  criado (order ${nextOrder}): "${label}"`);
      nextOrder += 1;
    }
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
