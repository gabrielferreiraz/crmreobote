/**
 * Reset de fábrica antes da migração real do Agendor — confirmado
 * explicitamente pelo usuário: mantém só o login do Dono (Reobote TI -
 * Gabriel), apaga todo o resto de dado da organização "Reobote Consorcios"
 * (negócio, contato, tarefa, campanha/script, conversa/mensagem de
 * WhatsApp, pipeline/etapa, automação), desconecta todo WhatsApp de
 * verdade (não só a linha do banco), e remove por completo as 4
 * organizações de teste sem relação com a Reobote que também existiam no
 * banco.
 *
 * Estratégia: como TODO modelo com organizationId tem onDelete: Cascade
 * pra Organization (confirmado — grep não achou nenhuma exceção), apagar a
 * Organization inteira já limpa tudo embaixo dela de uma vez, sem precisar
 * enumerar ~28 tabelas em ordem de dependência na mão. Depois recria a
 * organização com o MESMO id/slug (nada externo que referencie esse id
 * quebra) e só a filiação do Gabriel.
 *
 * Uso: npx tsx --env-file=.env scripts/factory-reset-reobote.ts
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { logoutInstance } from "@/lib/evolution";

const KEEP_ORG_ID = "cmr9i96330001ekvpb3b4o4nn";
const GABRIEL_EMAIL = "reoboteconsorciosti@gmail.com";

async function main() {
  const gabriel = await prisma.user.findUniqueOrThrow({ where: { email: GABRIEL_EMAIL } });
  console.log(`Dono a manter: ${gabriel.name} <${gabriel.email}> (${gabriel.id})`);

  const orgBefore = await prisma.organization.findUniqueOrThrow({ where: { id: KEEP_ORG_ID } });
  const membershipBefore = await runWithTenant(KEEP_ORG_ID, () =>
    prisma.organizationUser.findFirstOrThrow({ where: { organizationId: KEEP_ORG_ID, userId: gabriel.id } }),
  );

  // Passo 1: desconecta de verdade toda instância Evolution da Reobote —
  // apagar só a linha do banco deixaria a sessão órfã presa no servidor
  // Evolution. Best-effort (loga e segue) — se o Evolution já não reconhecer
  // a instância, não deve travar o reset.
  const instances = await runWithTenant(KEEP_ORG_ID, () =>
    prisma.whatsAppInstance.findMany({ where: { organizationId: KEEP_ORG_ID, provider: "EVOLUTION" } }),
  );
  console.log(`\n${instances.length} instância(s) Evolution encontrada(s) — desconectando de verdade:`);
  for (const inst of instances) {
    try {
      await logoutInstance(inst.instanceName);
      console.log(`  ✅ desconectada: ${inst.instanceName} (${inst.phoneNumber ?? "sem número"})`);
    } catch (err) {
      console.error(`  ⚠️ falha ao desconectar ${inst.instanceName} (seguindo mesmo assim):`, err instanceof Error ? err.message : err);
    }
  }

  // Passo 2: apaga TODAS as organizações (a Reobote incluída) — cascade
  // limpa tudo embaixo de cada uma.
  const allOrgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`\n${allOrgs.length} organização(ões) no banco — apagando todas:`);
  for (const org of allOrgs) {
    await runWithTenant(org.id, () => prisma.organization.delete({ where: { id: org.id } }));
    console.log(`  apagada: ${org.name} (${org.id})`);
  }

  // Passo 3: recria a Reobote Consorcios, idêntica (mesmo id/slug/data de
  // criação) — Organization não tem RLS, não precisa de runWithTenant aqui.
  await prisma.organization.create({
    data: { id: orgBefore.id, name: orgBefore.name, slug: orgBefore.slug, createdAt: orgBefore.createdAt },
  });
  console.log(`\nOrganização "${orgBefore.name}" recriada (mesmo id).`);

  // Passo 4: recria só a filiação do Gabriel, com o mesmo papel/área de antes.
  await runWithTenant(KEEP_ORG_ID, () =>
    prisma.organizationUser.create({
      data: {
        organizationId: KEEP_ORG_ID,
        userId: gabriel.id,
        role: membershipBefore.role,
        area: membershipBefore.area,
        active: true,
      },
    }),
  );
  console.log(`Filiação de ${gabriel.name} recriada como ${membershipBefore.role}.`);

  // Passo 5: nesse ponto, a ÚNICA linha de OrganizationUser em todo o banco
  // é a do Gabriel (todas as outras organizações e filiações já foram
  // apagadas) — qualquer outro User agora é garantidamente órfão. User não
  // tem organizationId (tabela global), não precisa de tenant context.
  const orphanUsers = await prisma.user.findMany({
    where: { id: { not: gabriel.id } },
    select: { id: true, name: true, email: true },
  });
  console.log(`\n${orphanUsers.length} usuário(s) órfão(s) — apagando:`);
  for (const u of orphanUsers) console.log(`  ${u.name} <${u.email}>`);
  if (orphanUsers.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: orphanUsers.map((u) => u.id) } } });
  }

  console.log("\n✅ Reset de fábrica concluído.");
}

main()
  .catch((err) => {
    console.error("\n❌ Falhou:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
