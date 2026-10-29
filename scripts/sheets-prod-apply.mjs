// Aplica UMA migration das Planilhas em produção numa única transação
// (falhou = nada muda). Uso:
//   node scripts/sheets-prod-apply.mjs <pasta-da-migration>
//   npx prisma migrate resolve --applied <pasta-da-migration>
import "dotenv/config";
import pg from "pg";
import { readFileSync } from "node:fs";

const dir = process.argv[2];
if (!/^20\d{12}_sheets/.test(dir ?? "")) throw new Error("informe a pasta de uma migration das Planilhas");
const sql = readFileSync(`prisma/migrations/${dir}/migration.sql`, "utf8");
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const [{ current_user }] = (await c.query("SELECT current_user")).rows;
if (current_user !== "postgres") throw new Error(`esperava postgres, conectado como ${current_user}`);
try {
  await c.query("BEGIN");
  await c.query("SET LOCAL lock_timeout = '5s'");
  await c.query(sql);
  await c.query("COMMIT");
  console.log(`migration ${dir} aplicada`);
} catch (err) {
  await c.query("ROLLBACK");
  console.error("FALHOU, nada foi alterado:", err.message);
  process.exitCode = 1;
}
await c.end();
