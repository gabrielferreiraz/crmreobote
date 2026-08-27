-- Link público (sem login) da TV — token só de leitura, próprio (não
-- reaproveita ApiKey, ver comentário do model em prisma/schema.prisma).

-- CreateTable: TvDisplayLink — só o hash do token é persistido, nunca o
-- token em si (mesmo padrão de ApiKey).
CREATE TABLE "TvDisplayLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TvDisplayLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TvDisplayLink_tokenHash_key" ON "TvDisplayLink"("tokenHash");
CREATE INDEX "TvDisplayLink_organizationId_idx" ON "TvDisplayLink"("organizationId");

ALTER TABLE "TvDisplayLink" ADD CONSTRAINT "TvDisplayLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TvDisplayLink" ADD CONSTRAINT "TvDisplayLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TvDisplayLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TvDisplayLink" FORCE ROW LEVEL SECURITY;
-- Bootstrap policy (mesmo padrão de ApiKey, ver
-- 20260717090000_api_integrations): a TV pública só conhece o próprio
-- token (convertido em hash antes de chegar aqui), o organizationId ainda
-- precisa ser descoberto a partir dele.
CREATE POLICY tenant_isolation ON "TvDisplayLink"
  USING (
    "organizationId" = current_setting('app.current_organization_id', true)
    OR "tokenHash" = current_setting('app.current_tv_link_token_hash', true)
  )
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
