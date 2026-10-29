// Checagem somente leitura antes/depois da migration das Planilhas.
import "dotenv/config";
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const q = async (sql, p) => (await c.query(sql, p)).rows;
console.log("tabelas Sheet*:", (await q(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'Sheet%'`)).map((r) => r.tablename));
console.log("enum:", (await q(`SELECT typname FROM pg_type WHERE typname='SheetColumnType'`)).length);
console.log("privilégios app_runtime em ServopaCampaign:", await q(`SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee='app_runtime' AND table_name='ServopaCampaign'`));
console.log("default privileges:", await q(`SELECT pg_get_userbyid(defaclrole) AS owner, defaclobjtype, defaclacl::text FROM pg_default_acl`));
for (const t of ["Sheet", "SheetColumn", "SheetRow", "SheetRowLink", "SheetActivity"]) {
  const r = await q(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname=$1`, [t]);
  if (r.length) console.log(t, "RLS:", r[0], "grants:", (await q(`SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee='app_runtime' AND table_name=$1`, [t])).map((x) => x.privilege_type).join(","));
}
await c.end();
