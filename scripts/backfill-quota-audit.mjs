// Reconstrói na auditoria as cotas que foram marcadas como cadastradas ANTES de a auditoria existir.
//
// O que faz: para cada cadastro com `quotaRegisteredAt` e sem nenhum evento DEAL_QUOTA_REGISTERED
// na auditoria, insere UM evento com a data/hora e a pessoa que estão no próprio cadastro
// (quotaRegisteredAt / quotaRegisteredById). O texto avisa que é um registro reconstruído.
//
// Segurança: só INSERE (a auditoria é append-only), é idempotente (rodar de novo não repete) e,
// por padrão, só MOSTRA o que faria. Para gravar de verdade: --apply
//
//   node scripts/backfill-quota-audit.mjs           (simulação)
//   node scripts/backfill-quota-audit.mjs --apply   (grava)
import "dotenv/config";
import { randomBytes } from "node:crypto";
import pg from "pg";

const APPLY = process.argv.includes("--apply");
const TZ = "America/Campo_Grande";
const dateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const when = (d) => `${dateFmt.format(d)} às ${timeFmt.format(d)}`;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows } = await client.query(`
  SELECT r."organizationId", r."dealId", r."quotaRegisteredAt", r."quotaRegisteredById",
         r."groupNumber", r."quotaNumber", r."quotaDigit", r."termMonths", r."paymentMethod", r."completedAt",
         d."closedAt", c."name" AS "clientName", u."name" AS "actorName"
  FROM "DealRegistration" r
  JOIN "Deal" d ON d."id" = r."dealId"
  JOIN "Contact" c ON c."id" = d."contactId"
  LEFT JOIN "User" u ON u."id" = r."quotaRegisteredById"
  WHERE r."quotaRegisteredAt" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "AuditLog" a
      WHERE a."action" = 'DEAL_QUOTA_REGISTERED' AND a."targetId" = r."dealId" AND a."organizationId" = r."organizationId"
    )
  ORDER BY r."quotaRegisteredAt"
`);

console.log(`${rows.length} cota(s) marcada(s) sem registro na auditoria.`);
const entries = rows.map((r) => {
  const parts = [
    r.groupNumber ? `Grupo ${r.groupNumber}` : null,
    r.quotaNumber ? `Cota ${r.quotaNumber}${r.quotaDigit ? `-${r.quotaDigit}` : ""}` : null,
    r.termMonths ? `Prazo ${r.termMonths} meses` : null,
    r.paymentMethod ? `Pagamento ${r.paymentMethod}` : null,
  ].filter(Boolean);
  const at = new Date(r.quotaRegisteredAt);
  const requested = r.completedAt ?? r.closedAt;
  const detail = [
    "Cota marcada como cadastrada na administradora.",
    parts.length ? `${parts.join(" · ")}.` : null,
    requested ? `Pedido do consultor em ${when(new Date(requested))}.` : null,
    "Registro reconstruído: a marcação foi feita antes de a auditoria existir; data e responsável vêm do próprio cadastro.",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    r,
    at,
    row: {
      id: `c${randomBytes(12).toString("hex")}`,
      organizationId: r.organizationId,
      actorUserId: r.quotaRegisteredById ?? null,
      actorName: r.actorName ?? "Administrativo",
      action: "DEAL_QUOTA_REGISTERED",
      targetType: "Deal",
      targetId: r.dealId,
      targetLabel: r.clientName,
      detail,
      changes: JSON.stringify([{ field: "quotaRegisteredAt", label: "Situação da cota", from: "Pendente", to: `Cadastrada em ${when(at)}` }]),
      createdAt: at,
    },
  };
});

for (const e of entries) console.log(`- ${when(e.at)} · ${e.row.targetLabel} · por ${e.row.actorName}\n    ${e.row.detail}`);

if (!APPLY) {
  console.log("\nSimulação: nada foi gravado. Use --apply para gravar.");
  await client.end();
  process.exit(0);
}

try {
  await client.query("BEGIN");
  for (const { row } of entries) {
    await client.query(`SELECT set_config('app.current_organization_id', $1, true)`, [row.organizationId]);
    await client.query(
      `INSERT INTO "AuditLog" ("id","organizationId","actorUserId","actorName","action","targetType","targetId","targetLabel","detail","changes","createdAt")
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11
       WHERE NOT EXISTS (SELECT 1 FROM "AuditLog" WHERE "action"='DEAL_QUOTA_REGISTERED' AND "targetId"=$7 AND "organizationId"=$2)`,
      [row.id, row.organizationId, row.actorUserId, row.actorName, row.action, row.targetType, row.targetId, row.targetLabel, row.detail, row.changes, row.createdAt],
    );
  }
  await client.query("COMMIT");
  console.log(`\nGravado: ${entries.length} evento(s).`);
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Falhou; nada foi gravado.", err);
  process.exitCode = 1;
} finally {
  await client.end();
}
