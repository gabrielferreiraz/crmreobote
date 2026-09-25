/**
 * Corrige o dono de negócios criados por resposta de campanha MANUAL que
 * foram parar num "terceiro" sorteado pelo rodízio (pickOwnerId) — bug
 * corrigido em lib/campaigns/reply.ts (resolveReplyOwnerId). Aplica a MESMA
 * regra de lá, retroativamente:
 *   1. responsável do contato, se ativo;
 *   2. senão, quem criou a campanha, se ativo;
 *   3. senão, deixa como está (não sobrou ninguém ligado ao lead).
 *
 * Só toca em negócio cujo dono atual É diferente do correto. Cada troca gera
 * uma Activity SYSTEM no negócio (rastro do que mudou e por quê). NÃO mexe em
 * Contact.responsavelId.
 *
 * Relatório por padrão (nada é gravado) — --apply grava.
 *   npx tsx --env-file=.env scripts/fix-campaign-reply-owners.ts
 *   npx tsx --env-file=.env scripts/fix-campaign-reply-owners.ts --apply
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

const ORG_ID = "cmr9i96330001ekvpb3b4o4nn";
const APPLY = process.argv.includes("--apply");

async function main() {
  await runWithTenant(ORG_ID, async () => {
    const recipients = await prisma.campaignRecipient.findMany({
      where: {
        repliedAt: { not: null },
        dealId: { not: null },
        campaign: { organizationId: ORG_ID, source: "MANUAL" },
      },
      select: {
        dealId: true,
        campaign: { select: { name: true, createdById: true } },
        contact: { select: { name: true, responsavelId: true } },
      },
    });

    const members = await prisma.organizationUser.findMany({
      where: { organizationId: ORG_ID },
      select: { userId: true, active: true, user: { select: { name: true } } },
    });
    const activeById = new Map(members.map((m) => [m.userId, m.active]));
    const nameById = new Map(members.map((m) => [m.userId, m.user.name]));
    const label = (id: string | null) => (id ? `${nameById.get(id) ?? id}${activeById.get(id) ? "" : " (inativo)"}` : "—");

    const deals = await prisma.deal.findMany({
      where: { id: { in: recipients.map((r) => r.dealId!) } },
      select: { id: true, name: true, ownerId: true, status: true },
    });
    const dealById = new Map(deals.map((d) => [d.id, d]));

    const seen = new Set<string>();
    const changes: { dealId: string; name: string; status: string; from: string; to: string; reason: string; campaign: string }[] = [];
    let alreadyOk = 0;
    let noOneActive = 0;

    for (const r of recipients) {
      const deal = dealById.get(r.dealId!);
      if (!deal || seen.has(deal.id)) continue;
      seen.add(deal.id);

      const resp = r.contact.responsavelId;
      let target: string | null = null;
      let reason = "";
      if (resp && activeById.get(resp)) {
        target = resp;
        reason = "responsável ativo do contato";
      } else if (activeById.get(r.campaign.createdById)) {
        target = r.campaign.createdById;
        reason = resp ? "responsável do contato inativo → quem criou a campanha" : "contato sem responsável → quem criou a campanha";
      }

      if (!target) {
        noOneActive++;
        continue;
      }
      if (deal.ownerId === target) {
        alreadyOk++;
        continue;
      }
      changes.push({
        dealId: deal.id,
        name: deal.name,
        status: deal.status,
        from: deal.ownerId,
        to: target,
        reason,
        campaign: r.campaign.name,
      });
    }

    console.log(`Negócios de campanha MANUAL analisados: ${seen.size}`);
    console.log(`  já corretos: ${alreadyOk} | sem ninguém ativo pra receber (mantidos): ${noOneActive} | A REATRIBUIR: ${changes.length}`);
    const byStatus = new Map<string, number>();
    for (const c of changes) byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1);
    console.log(`  por status: ${[...byStatus.entries()].map(([s, n]) => `${s}=${n}`).join(", ") || "—"}`);
    console.log("\nDetalhe:");
    for (const c of changes) {
      console.log(`  [${c.status}] "${c.name}" (${c.campaign}): ${label(c.from)} → ${label(c.to)}  · ${c.reason}`);
    }

    if (!APPLY) {
      console.log("\n[relatório apenas — nada foi gravado; rode com --apply]");
      return;
    }

    let done = 0;
    for (const c of changes) {
      await prisma.deal.update({ where: { id: c.dealId }, data: { ownerId: c.to } });
      await prisma.activity.create({
        data: {
          organizationId: ORG_ID,
          dealId: c.dealId,
          userId: c.to,
          type: "SYSTEM",
          body: `correção automática de responsável: negócio de resposta à campanha "${c.campaign}" foi atribuído a ${label(c.from)} por sorteio; devolvido a ${label(c.to)} (${c.reason})`,
        },
      });
      done++;
    }
    console.log(`\nConcluído: ${done} negócios reatribuídos.`);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
