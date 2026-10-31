-- Campanha sazonal "Lista dos 50" (Novembro Black): liga/desliga por
-- organização, sem apagar nada entre uma temporada e outra. Migration
-- aditiva: cria somente esta tabela.

CREATE TABLE "Lista50Config" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "startsOn" DATE,
    "weeklyGoal" INTEGER NOT NULL DEFAULT 50,
    "pipelineId" TEXT,
    "stageId" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lista50Config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Lista50Config_organizationId_key" ON "Lista50Config"("organizationId");

ALTER TABLE "Lista50Config" ADD CONSTRAINT "Lista50Config_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Lista50Config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lista50Config" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "Lista50Config"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
