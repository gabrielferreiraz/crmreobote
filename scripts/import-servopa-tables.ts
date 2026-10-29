/**
 * Carrega no CRM uma coleta das tabelas da Servopa que já está salva em
 * arquivos (um JSON por grupo, `{grupo}-S.json`, mais `_listas.json`
 * com a lista de grupos — prazo total e vagas). É a carga inicial enquanto o
 * robô ainda não fala direto com a API; usa o MESMO caminho de gravação que a
 * API vai usar (lib/servopa-tables/sync.ts).
 *
 * Sem `--apply` só LÊ os arquivos e mostra o que seria gravado (não abre
 * conexão com o banco). Com `--apply` grava na organização informada.
 *
 * Uso:
 *   npx tsx scripts/import-servopa-tables.ts worker/.probe/fast
 *   npx tsx --env-file=.env scripts/import-servopa-tables.ts worker/.probe/fast --org <organizationId> --apply
 *
 * O arquivo da coleta é considerado COMPLETO (grupos ausentes ou sem vagas são
 * removidos do banco) — passe `--partial` se for só um pedaço. Uma importação
 * completa exige `_listas.json`, pois ele comprova quais grupos eram esperados.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { normalizeGroup, parseCount, ServopaParseError } from "@/lib/servopa-tables/parse";
import type { ServopaSnapshotEvidence } from "@/lib/servopa-tables/snapshot-validation";
import type { NormalizedGroup, ScrapedGroup, ScrapedListRow } from "@/lib/servopa-tables/types";

const args = process.argv.slice(2);
const orgIndex = args.indexOf("--org");
const organizationId = orgIndex >= 0 ? args[orgIndex + 1] : undefined;
const dir = args.find((a, i) => !a.startsWith("--") && !(orgIndex >= 0 && i === orgIndex + 1));
const apply = args.includes("--apply");
const complete = !args.includes("--partial");

if (!dir) {
  console.error("Uso: npx tsx scripts/import-servopa-tables.ts <pasta> [--org <id>] [--apply] [--partial]");
  process.exit(1);
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

async function main() {
  const files = readdirSync(dir!).filter((f) => /^\d+-S\.json$/.test(f)).sort();
  if (!files.length) throw new Error(`Nenhum arquivo {grupo}-S.json em ${dir}`);

  const listFile = path.join(dir!, "_listas.json");
  const listByGroup = new Map<string, ScrapedListRow>();
  let listas: Record<string, ScrapedListRow[]> | null = null;
  if (existsSync(listFile)) {
    listas = readJson<Record<string, ScrapedListRow[]>>(listFile);
    for (const row of [...(listas.IS ?? []), ...(listas.MS ?? [])]) listByGroup.set(row.grupo, row);
  } else if (complete || apply) {
    throw new Error(`Coleta rejeitada: o arquivo ${listFile} é obrigatório para conferir grupos e vagas.`);
  } else {
    console.warn(`(sem ${listFile}: simulação parcial sem prazo total e vagas)`);
  }

  const groups: NormalizedGroup[] = [];
  const errors: string[] = [];
  for (const f of files) {
    try {
      const scraped = readJson<ScrapedGroup>(path.join(dir!, f));
      groups.push(normalizeGroup(scraped, listByGroup.get(scraped.grupo)));
    } catch (e) {
      errors.push(`${f}: ${e instanceof ServopaParseError ? e.message : String(e)}`);
    }
  }

  const tables = groups.reduce((n, g) => n + g.tables.length, 0);
  const rows = groups.reduce((n, g) => n + g.tables.reduce((m, t) => m + t.rows.length, 0), 0);
  const byseg = (s: string) => groups.filter((g) => g.segment === s).length;
  console.log(`Lidos ${files.length} arquivos → ${groups.length} grupos (${byseg("REAL_ESTATE")} imóveis, ${byseg("MOVABLE")} móveis), ${tables} tabelas, ${rows} linhas.`);
  if (errors.length) {
    console.error(`\n${errors.length} arquivo(s) com problema — nada foi gravado:`);
    for (const e of errors) console.error("  -", e);
    process.exit(2);
  }

  if (!apply) {
    console.log("\nSimulação (sem --apply): nada foi gravado.");
    return;
  }
  if (!organizationId) throw new Error("Informe --org <organizationId> para gravar");

  const evidence: ServopaSnapshotEvidence | undefined = listas
    ? {
        lists: [
          {
            segment: "REAL_ESTATE",
            httpStatus: 200,
            cloudflareBlocked: false,
            groups: (listas.IS ?? []).map((row) => ({ number: row.grupo, vacancies: parseCount(row.vagas) })),
          },
          {
            segment: "MOVABLE",
            httpStatus: 200,
            cloudflareBlocked: false,
            groups: (listas.MS ?? []).map((row) => ({ number: row.grupo, vacancies: parseCount(row.vagas) })),
          },
        ],
        pages: files.map((file) => ({
          number: file.replace(/-S\.json$/, ""),
          httpStatus: 200,
          cloudflareBlocked: false,
        })),
      }
    : undefined;

  // Import dinâmico: a simulação acima não precisa de DATABASE_URL.
  const { syncServopaSnapshot } = await import("@/lib/servopa-tables/sync");
  const { summary, runId } = await syncServopaSnapshot({ organizationId, groups, trigger: "IMPORT", complete, evidence });
  console.log(`\nGravado (execução ${runId}):`);
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .then(() => process.exit(process.exitCode ?? 0));
