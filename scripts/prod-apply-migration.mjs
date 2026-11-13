// Aplica UMA migration no banco configurado (DATABASE_URL), numa única
// transação — falhou = nada muda. Serve para quando `prisma migrate deploy`
// se recusa a rodar porque o histórico local está defasado em relação à
// produção (migrations feitas em outra máquina), situação em que a migration
// nova fica eternamente "not yet applied".
//
// Uso:
//   node scripts/prod-apply-migration.mjs <pasta-da-migration>
//   npx prisma migrate resolve --applied <pasta-da-migration>
//
// O segundo comando é obrigatório: ele registra a migration na tabela
// _prisma_migrations. Sem isso o Prisma continua achando que ela está
// pendente e tentaria aplicá-la de novo no próximo deploy.
//
// Irmão mais velho e específico: scripts/sheets-prod-apply.mjs.
import "dotenv/config";
import pg from "pg";
import { readFileSync, existsSync } from "node:fs";

const dir = process.argv[2];
// Só o nome da pasta — nada de caminho relativo/absoluto vindo da linha de
// comando montar um caminho para fora de prisma/migrations.
if (!/^\d{14}_[a-z0-9_]+$/.test(dir ?? "")) {
  throw new Error("informe o NOME da pasta da migration (ex.: 20261112120000_deal_archive)");
}
const path = `prisma/migrations/${dir}/migration.sql`;
if (!existsSync(path)) throw new Error(`não achei ${path}`);
const sql = readFileSync(path, "utf8");

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const [{ current_user }] = (await c.query("SELECT current_user")).rows;
if (current_user !== "postgres") throw new Error(`esperava postgres, conectado como ${current_user}`);

console.log(`aplicando ${dir}…`);
try {
  await c.query("BEGIN");
  // Teto curto de espera por lock: se alguma transação estiver segurando a
  // tabela, é melhor falhar em 5s do que deixar um ALTER enfileirado
  // travando o CRM inteiro.
  await c.query("SET LOCAL lock_timeout = '5s'");
  await c.query(sql);
  await c.query("COMMIT");
  console.log(`migration ${dir} aplicada`);
  console.log(`agora registre: npx prisma migrate resolve --applied ${dir}`);
} catch (err) {
  await c.query("ROLLBACK");
  console.error("FALHOU, nada foi alterado:", err.message);
  process.exitCode = 1;
}
await c.end();
