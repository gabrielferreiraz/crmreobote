/**
 * Corpo de verdade da leitura de planilha (.csv/.xlsx) — roda DENTRO de um
 * worker_thread, nunca no processo principal. Ver lib/parse-spreadsheet.ts
 * (o wrapper que spawna este arquivo) pro porquê: ExcelJS 4.4.0 (a versão
 * mais nova publicada — não existe correção oficial ainda) tem duas
 * vulnerabilidades reais e conhecidas que se aplicam direto num arquivo
 * enviado por qualquer usuário logado:
 *
 *  - CVE-2026-78206 (7.5 ALTA): descompacta o .xlsx inteiro na memória sem
 *    limite nenhum — um arquivo de poucos KB muito comprimido pode virar
 *    vários GB na RAM (zip bomb).
 *  - CVE-2026-78207 (9.4 CRÍTICA): prototype pollution via chave __proto__/
 *    constructor numa nota de célula, corrompendo Object.prototype do
 *    processo inteiro.
 *
 * As duas são resolvidas pela MESMA técnica, sem precisar trocar de
 * biblioteca nem patchear nada: cada Worker do Node tem o próprio V8
 * Isolate — heap separado (resourceLimits abaixo mata SÓ este worker se
 * estourar, o processo principal nunca sente) e Object.prototype separado
 * (mesmo que um arquivo malicioso corrompa o prototype AQUI DENTRO, esse
 * worker é destruído logo em seguida — nunca existe um segundo arquivo
 * processado pelo mesmo worker "sujo", e o processo principal nunca
 * enxergou a corrupção). Import path RELATIVO (nunca o alias "@/") de
 * propósito — este arquivo é carregado pelo Node puro via
 * `new Worker(caminho)`, fora do build do Next.js, então o alias de
 * tsconfig não é resolvido em runtime.
 */
import { parentPort, workerData } from "worker_threads";
import ExcelJS from "exceljs";
import { Readable } from "stream";
// Extensão ".ts" EXPLÍCITA no import — sem "type": "module" em package.json,
// o Node detecta este arquivo como ESM pela SINTAXE (import/export no topo,
// não require), e resolução de ESM (diferente de CommonJS) exige extensão
// explícita em import relativo — confirmado na prática: sem isto, quebra em
// "Cannot find module '.../lib/csv-sanitize'" (procurava o nome exato, sem
// tentar variações de extensão).
import { sanitizeCell } from "./csv-sanitize.ts";

type WorkerInput = { buffer: Uint8Array; filename: string };
type WorkerOutput = { ok: true; rows: string[][] } | { ok: false; error: string };

/** Mesma heurística de lib/parse-spreadsheet.ts (comentário completo lá). */
function detectCsvDelimiter(buffer: Buffer): string {
  const firstLine = buffer.toString("utf-8").split(/\r?\n/, 1)[0] ?? "";
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

async function parse({ buffer, filename }: { buffer: Buffer; filename: string }): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  const lowerFilename = filename.toLowerCase();
  const isCsv = lowerFilename.endsWith(".csv");

  if (!isCsv && lowerFilename.endsWith(".xls")) {
    throw new Error("XLS_NOT_SUPPORTED");
  }

  let worksheet: ExcelJS.Worksheet | undefined;
  if (isCsv) {
    const delimiter = detectCsvDelimiter(buffer);
    worksheet = await workbook.csv.read(Readable.from(buffer), { parserOptions: { delimiter } });
  } else {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    worksheet = workbook.worksheets[0];
  }

  if (!worksheet) return [];

  const rows: string[][] = [];
  worksheet.eachRow((row) => {
    const values = row.values as unknown[];
    const cells = values.slice(1).map((v) => (v === null || v === undefined ? "" : sanitizeCell(String(v).trim())));
    rows.push(cells);
  });
  return rows;
}

// Sem parentPort = alguém tentou rodar este arquivo fora de um worker_thread
// (ex.: `node lib/parse-spreadsheet-worker.ts` direto) — não deveria
// acontecer em uso normal, mas falha explícito em vez de silencioso.
if (!parentPort) throw new Error("parse-spreadsheet-worker precisa rodar dentro de um worker_thread");

const { buffer, filename } = workerData as WorkerInput;

parse({ buffer: Buffer.from(buffer), filename })
  .then((rows) => {
    const msg: WorkerOutput = { ok: true, rows };
    parentPort!.postMessage(msg);
  })
  .catch((err: unknown) => {
    const msg: WorkerOutput = { ok: false, error: err instanceof Error ? err.message : String(err) };
    parentPort!.postMessage(msg);
  });
