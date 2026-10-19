import pg from "pg";

const { Client } = pg;

const connectionString = process.env.DATABASE_URL_APP || process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL_APP ou DATABASE_URL nao configurada.");
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString });
  let transactionOpen = false;

  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    transactionOpen = true;

    const columnResult = await client.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('WhatsAppInstance', 'WhatsAppThread', 'Contact')
        AND column_name IN (
          'kind', 'assigneeId', 'inboxStatus', 'ownerUserId', 'userId',
          'jobTitle', 'needsEnrichment'
        )
      ORDER BY table_name, column_name
    `);
    const columns = new Set(columnResult.rows.map((row) => `${row.table_name}.${row.column_name}`));
    const hasInstanceKind = columns.has("WhatsAppInstance.kind");
    const hasAssignee = columns.has("WhatsAppThread.assigneeId");
    const hasInboxStatus = columns.has("WhatsAppThread.inboxStatus");
    const hasNeedsEnrichment = columns.has("Contact.needsEnrichment");

    const structuralResult = await client.query(`
      SELECT
        (SELECT count(*)::int = 4
           FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN (
              'LeadDistributionPool', 'LeadDistributionPoolMember',
              'LeadDistributionCursor', 'WhatsAppAssignmentEvent'
            )) AS has_all_central_tables,
        (SELECT count(*)::int = 4
           FROM pg_class
          WHERE relnamespace = 'public'::regnamespace
            AND relname IN (
              'LeadDistributionPool', 'LeadDistributionPoolMember',
              'LeadDistributionCursor', 'WhatsAppAssignmentEvent'
            )
            AND relrowsecurity
            AND relforcerowsecurity) AS central_tables_force_rls,
        (SELECT count(*)::int = 4
           FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename IN (
              'LeadDistributionPool', 'LeadDistributionPoolMember',
              'LeadDistributionCursor', 'WhatsAppAssignmentEvent'
            )
            AND policyname = 'tenant_isolation') AS has_all_tenant_policies,
        (SELECT count(*)::int = 3
           FROM pg_constraint
          WHERE conname IN (
              'WhatsAppInstance_connectedById_fkey',
              'WhatsAppThread_assigneeId_fkey',
              'WhatsAppMessage_attributedUserId_fkey'
            )
            AND confdeltype = 'n') AS user_links_set_null,
        EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conname = 'WhatsAppInstance_kind_personalOwner_check'
        ) AS has_instance_owner_check,
        EXISTS (
          SELECT 1 FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname = 'WhatsAppInstance_organizationId_provider_central_key'
        ) AS has_central_instance_unique_index
    `);

    const organizations = await client.query('SELECT id, name FROM "Organization" ORDER BY name');
    const audit = [];

    for (const organization of organizations.rows) {
      await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organization.id]);

      const counts = await client.query(
        `
          SELECT
            (SELECT count(*)::int FROM "WhatsAppInstance" WHERE "organizationId" = $1) AS instances,
            (SELECT count(*)::int FROM "WhatsAppThread" WHERE "organizationId" = $1) AS threads,
            (SELECT count(*)::int FROM "WhatsAppThread" WHERE "organizationId" = $1 AND "instanceId" IS NOT NULL) AS threads_with_instance,
            (SELECT count(*)::int FROM "WhatsAppThread" WHERE "organizationId" = $1 AND "instanceId" IS NULL) AS archived_threads,
            (SELECT count(*)::int FROM "WhatsAppThread" WHERE "organizationId" = $1 AND "ownerUserId" IS NULL) AS threads_without_legacy_owner,
            (SELECT count(*)::int
               FROM "WhatsAppThread" t
               JOIN "WhatsAppInstance" i ON i.id = t."instanceId"
              WHERE t."organizationId" = $1
                AND t."ownerUserId" IS DISTINCT FROM i."userId") AS legacy_owner_mismatches,
            (SELECT count(*)::int FROM "Contact" WHERE "organizationId" = $1) AS contacts,
            (SELECT count(*)::int
               FROM "Contact"
              WHERE "organizationId" = $1
                AND ("jobTitle" IS NULL OR btrim("jobTitle") = '')) AS contacts_without_job_title,
            (SELECT count(*)::int
               FROM "Contact" c
              WHERE c."organizationId" = $1
                AND (c."jobTitle" IS NULL OR btrim(c."jobTitle") = '')
                AND EXISTS (
                  SELECT 1 FROM "Deal" d WHERE d."contactId" = c.id AND d.status = 'OPEN'
                )) AS contacts_without_job_title_with_open_deal
        `,
        [organization.id],
      );

      const instanceKindExpression = hasInstanceKind ? 'kind::text' : "'PERSONAL'::text";
      const instanceBreakdown = await client.query(
        `
          SELECT ${instanceKindExpression} AS kind, provider::text, status::text, count(*)::int AS count
          FROM "WhatsAppInstance"
          WHERE "organizationId" = $1
          GROUP BY 1, provider, status
          ORDER BY 1, provider, status
        `,
        [organization.id],
      );

      let instanceOwnershipAudit = null;
      if (hasInstanceKind) {
        const result = await client.query(
          `
            SELECT
              count(*) FILTER (WHERE kind = 'CENTRAL' AND "userId" IS NOT NULL)::int
                AS central_with_personal_owner,
              count(*) FILTER (WHERE kind = 'PERSONAL' AND "userId" IS NULL)::int
                AS personal_without_owner
            FROM "WhatsAppInstance"
            WHERE "organizationId" = $1
          `,
          [organization.id],
        );
        instanceOwnershipAudit = result.rows[0];
      }

      const stagesRequiringJobTitle = await client.query(
        `
          SELECT p.name AS pipeline, s.name AS stage
          FROM "PipelineStage" s
          JOIN "Pipeline" p ON p.id = s."pipelineId"
          WHERE p."organizationId" = $1
            AND 'contactJobTitle' = ANY(s."requiredFields")
          ORDER BY p."order", s."order"
        `,
        [organization.id],
      );

      let assignmentAudit = null;
      if (hasAssignee) {
        const legacyResult = await client.query(
          `
            SELECT
              count(*) FILTER (
                WHERE "instanceId" IS NULL AND "ownerUserId" IS NOT NULL AND "assigneeId" IS NULL
              )::int AS archived_personal_without_assignee,
              count(*) FILTER (
                WHERE "ownerUserId" IS NOT NULL AND "assigneeId" IS NULL
              )::int AS legacy_threads_without_assignee
            FROM "WhatsAppThread"
            WHERE "organizationId" = $1
          `,
          [organization.id],
        );

        let typedAudit = null;
        if (hasInstanceKind) {
          const statusColumns = hasInboxStatus
            ? `,
                count(*) FILTER (WHERE i.kind = 'PERSONAL' AND t."inboxStatus" IS NOT NULL)::int
                  AS personal_with_central_status,
                count(*) FILTER (WHERE i.kind = 'CENTRAL' AND t."inboxStatus" IS NULL)::int
                  AS central_without_status,
                count(*) FILTER (
                  WHERE i.kind = 'CENTRAL' AND t."inboxStatus" = 'OPEN' AND t."assigneeId" IS NULL
                )::int AS central_open_unassigned`
            : "";
          const result = await client.query(
            `
              SELECT
                count(*) FILTER (WHERE i.kind = 'PERSONAL' AND t."assigneeId" IS NULL)::int
                  AS live_personal_without_assignee
                ${statusColumns}
              FROM "WhatsAppThread" t
              JOIN "WhatsAppInstance" i ON i.id = t."instanceId"
              WHERE t."organizationId" = $1
            `,
            [organization.id],
          );
          typedAudit = result.rows[0];
        }

        assignmentAudit = { ...legacyResult.rows[0], ...typedAudit };
      }

      let enrichmentAudit = null;
      if (hasNeedsEnrichment) {
        const result = await client.query(
          `
            SELECT
              count(*) FILTER (WHERE "needsEnrichment")::int AS needs_enrichment,
              count(*) FILTER (WHERE "needsEnrichment" AND "jobTitle" IS NOT NULL AND btrim("jobTitle") <> '')::int
                AS stale_enrichment_flags
            FROM "Contact"
            WHERE "organizationId" = $1
          `,
          [organization.id],
        );
        enrichmentAudit = result.rows[0];
      }

      audit.push({
        organization: organization.name,
        ...counts.rows[0],
        instance_breakdown: instanceBreakdown.rows,
        instance_ownership_audit: instanceOwnershipAudit,
        stages_requiring_job_title: stagesRequiringJobTitle.rows,
        assignment_audit: assignmentAudit,
        enrichment_audit: enrichmentAudit,
      });
    }

    console.log(
      JSON.stringify(
        {
          schema_columns: columnResult.rows,
          schema_integrity: structuralResult.rows[0],
          organizations: audit,
        },
        null,
        2,
      ),
    );
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
