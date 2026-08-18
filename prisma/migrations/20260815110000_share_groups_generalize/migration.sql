-- Generaliza o compartilhamento entre consultores: além de agenda, agora
-- também dá pra compartilhar negócios e/ou clientes no MESMO grupo (3
-- interruptores independentes) — pedido logo depois do agenda-only original
-- (ver comentário em prisma/schema.prisma, model ShareGroup). Tabela criada
-- há minutos, sem uso real ainda — renomear em vez de recriar do zero só
-- por consistência de nomes com o schema novo.

ALTER TABLE "AgendaShareGroup" RENAME TO "ShareGroup";
ALTER TABLE "AgendaShareGroupMember" RENAME TO "ShareGroupMember";

ALTER TABLE "ShareGroup" RENAME CONSTRAINT "AgendaShareGroup_pkey" TO "ShareGroup_pkey";
ALTER TABLE "ShareGroup" RENAME CONSTRAINT "AgendaShareGroup_organizationId_fkey" TO "ShareGroup_organizationId_fkey";
ALTER TABLE "ShareGroup" RENAME CONSTRAINT "AgendaShareGroup_createdById_fkey" TO "ShareGroup_createdById_fkey";
ALTER INDEX "AgendaShareGroup_organizationId_idx" RENAME TO "ShareGroup_organizationId_idx";

ALTER TABLE "ShareGroupMember" RENAME CONSTRAINT "AgendaShareGroupMember_pkey" TO "ShareGroupMember_pkey";
ALTER TABLE "ShareGroupMember" RENAME CONSTRAINT "AgendaShareGroupMember_groupId_fkey" TO "ShareGroupMember_groupId_fkey";
ALTER TABLE "ShareGroupMember" RENAME CONSTRAINT "AgendaShareGroupMember_userId_fkey" TO "ShareGroupMember_userId_fkey";
ALTER INDEX "AgendaShareGroupMember_groupId_userId_key" RENAME TO "ShareGroupMember_groupId_userId_key";
ALTER INDEX "AgendaShareGroupMember_userId_idx" RENAME TO "ShareGroupMember_userId_idx";

-- shareAgenda default true: todo grupo já existente (só agenda-only até
-- aqui) continua se comportando exatamente igual depois da migração.
-- shareDeals/shareContacts default false: nada passa a compartilhar
-- negócio/cliente sozinho, é opt-in por grupo.
ALTER TABLE "ShareGroup" ADD COLUMN "shareAgenda" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ShareGroup" ADD COLUMN "shareDeals" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShareGroup" ADD COLUMN "shareContacts" BOOLEAN NOT NULL DEFAULT false;

-- As policies de RLS (tenant_isolation) referenciam a tabela por OID
-- internamente, não por nome em texto — sobrevivem ao RENAME acima sem
-- precisar recriar.
