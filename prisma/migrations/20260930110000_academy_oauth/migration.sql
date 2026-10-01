-- OAuth 2.0 Authorization Code + PKCE pra Reobote Academy — substitui o
-- fluxo de token JWT direto (Progresso, migration 20260930100000, não muda).
-- Escrita à mão (não gerada por `prisma migrate dev`): a shadow database do
-- migrate dev falha numa migração ANTERIOR e não relacionada
-- (20260812090000_tv_dashboard_config_rls), então toda migração nova neste
-- repo é escrita e aplicada manualmente.

-- CreateTable
CREATE TABLE "AcademyAuthCode" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademyAuthCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AcademyAccessToken" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "issuedFromCodeId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademyAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AcademyRefreshToken" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "issuedFromCodeId" TEXT NOT NULL,
    "sessionExpiresAt" TIMESTAMP(3) NOT NULL,
    "replacedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademyRefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AcademyAuthCode_codeHash_key" ON "AcademyAuthCode"("codeHash");
CREATE INDEX "AcademyAuthCode_organizationId_idx" ON "AcademyAuthCode"("organizationId");
CREATE INDEX "AcademyAuthCode_expiresAt_idx" ON "AcademyAuthCode"("expiresAt");

CREATE UNIQUE INDEX "AcademyAccessToken_tokenHash_key" ON "AcademyAccessToken"("tokenHash");
CREATE INDEX "AcademyAccessToken_organizationId_idx" ON "AcademyAccessToken"("organizationId");
CREATE INDEX "AcademyAccessToken_issuedFromCodeId_idx" ON "AcademyAccessToken"("issuedFromCodeId");
CREATE INDEX "AcademyAccessToken_expiresAt_idx" ON "AcademyAccessToken"("expiresAt");

CREATE UNIQUE INDEX "AcademyRefreshToken_tokenHash_key" ON "AcademyRefreshToken"("tokenHash");
CREATE INDEX "AcademyRefreshToken_organizationId_idx" ON "AcademyRefreshToken"("organizationId");
CREATE INDEX "AcademyRefreshToken_issuedFromCodeId_idx" ON "AcademyRefreshToken"("issuedFromCodeId");
CREATE INDEX "AcademyRefreshToken_sessionExpiresAt_idx" ON "AcademyRefreshToken"("sessionExpiresAt");

-- AddForeignKey
ALTER TABLE "AcademyAuthCode" ADD CONSTRAINT "AcademyAuthCode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcademyAuthCode" ADD CONSTRAINT "AcademyAuthCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AcademyAccessToken" ADD CONSTRAINT "AcademyAccessToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcademyAccessToken" ADD CONSTRAINT "AcademyAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcademyAccessToken" ADD CONSTRAINT "AcademyAccessToken_issuedFromCodeId_fkey" FOREIGN KEY ("issuedFromCodeId") REFERENCES "AcademyAuthCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AcademyRefreshToken" ADD CONSTRAINT "AcademyRefreshToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcademyRefreshToken" ADD CONSTRAINT "AcademyRefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcademyRefreshToken" ADD CONSTRAINT "AcademyRefreshToken_issuedFromCodeId_fkey" FOREIGN KEY ("issuedFromCodeId") REFERENCES "AcademyAuthCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: toda tabela com organizationId precisa disso (ver migrações
-- anteriores pro mesmo padrão). As três tabelas abaixo também precisam ser
-- localizáveis pelo HASH antes de se conhecer organizationId — mesmo
-- bootstrap que ApiKey/TvDisplayLink já usam, reaproveitando UMA variável
-- de sessão só (app.current_academy_credential_hash, ver
-- runWithAcademyCredentialLookup em lib/tenant-context.ts). WITH CHECK já
-- sai com o mesmo OR do USING desde o início (a migration
-- 20260910153700_fix_bootstrap_rls_with_check documenta o bug de esquecer
-- isso: todo UPDATE feito só pelo caminho do hash — marcar code usado,
-- marcar refresh token substituído/revogado — falharia em silêncio sem
-- este OR no WITH CHECK).
ALTER TABLE "AcademyAuthCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcademyAuthCode" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AcademyAuthCode"
  USING (
    "organizationId" = current_setting('app.current_organization_id', true)
    OR "codeHash" = current_setting('app.current_academy_credential_hash', true)
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_organization_id', true)
    OR "codeHash" = current_setting('app.current_academy_credential_hash', true)
  );

ALTER TABLE "AcademyAccessToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcademyAccessToken" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AcademyAccessToken"
  USING (
    "organizationId" = current_setting('app.current_organization_id', true)
    OR "tokenHash" = current_setting('app.current_academy_credential_hash', true)
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_organization_id', true)
    OR "tokenHash" = current_setting('app.current_academy_credential_hash', true)
  );

ALTER TABLE "AcademyRefreshToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcademyRefreshToken" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AcademyRefreshToken"
  USING (
    "organizationId" = current_setting('app.current_organization_id', true)
    OR "tokenHash" = current_setting('app.current_academy_credential_hash', true)
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_organization_id', true)
    OR "tokenHash" = current_setting('app.current_academy_credential_hash', true)
  );
