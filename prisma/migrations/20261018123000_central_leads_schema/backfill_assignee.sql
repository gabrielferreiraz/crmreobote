-- Executar separadamente depois da migration estrutural e repetir depois do
-- deploy. O codigo antigo pode criar novas threads pessoais sem assigneeId
-- no intervalo entre apply e deploy.
--
-- Idempotente: inclui threads pessoais arquivadas (instanceId NULL), pois o
-- ownerUserId preserva o dono mesmo depois que a instancia e removida.

DO $$
DECLARE
    tenant RECORD;
    affected INTEGER;
BEGIN
    FOR tenant IN SELECT "id" FROM "Organization"
    LOOP
        PERFORM set_config('app.current_organization_id', tenant."id", true);

        UPDATE "WhatsAppThread"
           SET "assigneeId" = "ownerUserId"
         WHERE "assigneeId" IS NULL
           AND "ownerUserId" IS NOT NULL
           AND "organizationId" = tenant."id";

        GET DIAGNOSTICS affected = ROW_COUNT;
        RAISE NOTICE 'tenant %, threads atualizadas: %', tenant."id", affected;
    END LOOP;
END $$;
