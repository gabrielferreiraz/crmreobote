import { Worker } from "worker_threads";
import path from "path";
import ExcelJS from "exceljs";

// Referência REAL a ExcelJS (não só um import por efeito colateral — testado
// e confirmado que o build de produção elimina esse tipo de import não
// usado, mesmo com a dependência de verdade em node_modules) — este arquivo
// nunca chama ExcelJS pra ler planilha (quem faz isso é o worker isolado,
// ver lib/parse-spreadsheet-worker.ts), mas é ELE, não o worker, que o
// rastreador de dependências do Next enxerga (`.next/standalone`, via
// @vercel/nft): o worker é carregado por um caminho dinâmico em runtime,
// fora do grafo estático de import/require que o rastreador segue. Sem uma
// referência de verdade aqui, "exceljs" e tudo que ele depende (archiver,
// jszip, saxes, ...) simplesmente não vão pra imagem final — confirmado
// num build de verificação: o worker existia no container, mas quebrava em
// "Cannot find module 'exceljs'" na primeira importação de planilha.
//
// A checagem em si tem valor próprio, não é só pretexto: falha CEDO (na
// inicialização do processo) e com uma mensagem clara, em vez de um erro
// obscuro de "módulo não encontrado" vindo de dentro do worker na primeira
// importação de alguém, minutos ou dias depois do deploy.
if (typeof ExcelJS.Workbook !== "function") {
  throw new Error("Dependência 'exceljs' ausente ou corrompida — importação de planilha não vai funcionar.");
}

/**
 * Lê um .csv/.xlsx enviado por upload (importação de Clientes/Negócios, ver
 * app/api/contacts/import e app/api/deals/import) num worker_thread
 * ISOLADO, nunca no processo principal — ver o comentário longo em
 * lib/parse-spreadsheet-worker.ts (o arquivo que roda de fato dentro do
 * worker) pro porquê: ExcelJS 4.4.0, a versão mais nova publicada (não
 * existe correção oficial ainda), tem duas vulnerabilidades reais
 * exploráveis por qualquer usuário logado mandando um arquivo malicioso —
 * zip bomb (CVE-2026-78206) e prototype pollution (CVE-2026-78207, 9.4
 * CRÍTICA). As duas são contidas pela isolação do worker (heap próprio,
 * V8 Isolate próprio — descartado inteiro depois de cada arquivo), sem
 * precisar trocar de biblioteca.
 *
 * Contrato IDÊNTICO ao de antes (mesma assinatura, mesmo erro sentinela
 * "XLS_NOT_SUPPORTED") — as 4 rotas que chamam isto não precisaram mudar
 * uma linha.
 */

// Generoso o bastante pra qualquer planilha de verdade dentro do limite de
// 5MB/20 mil linhas na importação de contatos (ver import-limits.ts) — um .xlsx legítimo desse
// tamanho descompacta pra, no máximo, poucas dezenas de MB. Bem abaixo do
// que ameaçaria um container pequeno, bem acima de qualquer uso real —
// estourar isto SÓ acontece com um arquivo construído de propósito pra
// abusar da descompactação (zip bomb).
const MAX_OLD_GENERATION_MB = 256;
const MAX_YOUNG_GENERATION_MB = 64;

// Um .xlsx de 5MB legítimo processa em bem menos de 1s. 20s cobre até um
// container com CPU compartilhada/ocupada sem deixar uma requisição travada
// pra sempre esperando um worker que nunca vai responder (arquivo
// construído pra gastar CPU sem necessariamente estourar memória).
const TIMEOUT_MS = 20_000;
const MAX_CONCURRENT_PARSERS = 2;
const MAX_WAITING_PARSERS = 4;
const MAX_XLSX_ENTRIES = 2_048;
const MAX_XLSX_EXPANDED_BYTES = 32 * 1024 * 1024;

export type SpreadsheetParseOptions = {
  /** Includes the header row. */
  maxRows: number;
  maxColumns?: number;
  maxCellCharacters?: number;
  maxTotalCharacters?: number;
};

type WorkerLimits = Required<SpreadsheetParseOptions>;

const DEFAULT_LIMITS: WorkerLimits = {
  maxRows: 1_001,
  maxColumns: 64,
  maxCellCharacters: 4_000,
  maxTotalCharacters: 12 * 1024 * 1024,
};

type ParserPool = { active: number; waiting: Array<() => void> };
const globalForSpreadsheetParsing = globalThis as unknown as { spreadsheetParserPool?: ParserPool };
// Route Handlers can load separate module copies in Next. The pool must be
// process-wide, otherwise each route could open two workers independently.
const parserPool = globalForSpreadsheetParsing.spreadsheetParserPool ?? { active: 0, waiting: [] };
globalForSpreadsheetParsing.spreadsheetParserPool = parserPool;

class SpreadsheetParseError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "SpreadsheetParseError";
  }
}

async function acquireParser(): Promise<() => void> {
  if (parserPool.active < MAX_CONCURRENT_PARSERS) {
    parserPool.active += 1;
    return releaseParser;
  }
  if (parserPool.waiting.length >= MAX_WAITING_PARSERS) throw new SpreadsheetParseError("SPREADSHEET_BUSY");
  await new Promise<void>((resolve) => parserPool.waiting.push(resolve));
  return releaseParser;
}

function releaseParser() {
  const next = parserPool.waiting.shift();
  if (next) {
    next();
    return;
  }
  parserPool.active -= 1;
}

function readU16(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset);
}

function readU32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset);
}

/** Rejects non-XLSX ZIP archives and archives that would expand too far. */
function validateXlsxArchive(buffer: Buffer) {
  const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const centralSignature = 0x02014b50;
  const earliestEnd = Math.max(0, buffer.length - 65_557);
  let endOffset = -1;

  for (let offset = buffer.length - 22; offset >= earliestEnd; offset -= 1) {
    if (buffer.subarray(offset, offset + 4).equals(endSignature) && offset + 22 + readU16(buffer, offset + 20) === buffer.length) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new SpreadsheetParseError("INVALID_XLSX_ARCHIVE");

  const entryCount = readU16(buffer, endOffset + 10);
  const centralSize = readU32(buffer, endOffset + 12);
  const centralOffset = readU32(buffer, endOffset + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff || entryCount > MAX_XLSX_ENTRIES) {
    throw new SpreadsheetParseError("INVALID_XLSX_ARCHIVE");
  }
  if (centralOffset + centralSize > endOffset) throw new SpreadsheetParseError("INVALID_XLSX_ARCHIVE");

  let offset = centralOffset;
  let expandedBytes = 0;
  let hasContentTypes = false;
  let hasWorkbook = false;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > endOffset || readU32(buffer, offset) !== centralSignature) throw new SpreadsheetParseError("INVALID_XLSX_ARCHIVE");
    const flags = readU16(buffer, offset + 8);
    const compressionMethod = readU16(buffer, offset + 10);
    const uncompressedSize = readU32(buffer, offset + 24);
    const fileNameLength = readU16(buffer, offset + 28);
    const extraLength = readU16(buffer, offset + 30);
    const commentLength = readU16(buffer, offset + 32);
    const nextOffset = offset + 46 + fileNameLength + extraLength + commentLength;
    if (nextOffset > endOffset || (flags & 0x1) !== 0 || (compressionMethod !== 0 && compressionMethod !== 8) || uncompressedSize === 0xffffffff) {
      throw new SpreadsheetParseError("INVALID_XLSX_ARCHIVE");
    }
    expandedBytes += uncompressedSize;
    if (expandedBytes > MAX_XLSX_EXPANDED_BYTES) throw new SpreadsheetParseError("XLSX_EXPANSION_LIMIT");

    const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    if (name === "[Content_Types].xml") hasContentTypes = true;
    if (name === "xl/workbook.xml") hasWorkbook = true;
    offset = nextOffset;
  }
  if (!hasContentTypes || !hasWorkbook) throw new SpreadsheetParseError("INVALID_XLSX_ARCHIVE");
}

// process.cwd() (não __dirname do arquivo compilado, que muda de lugar
// dentro do bundle do Next) — em produção é /app (WORKDIR do Dockerfile,
// que copia lib/ inteira pra lá de propósito, exatamente pra este caminho
// existir), em dev é a raiz do projeto (de onde `npm run dev` roda). Se um
// dia o WORKDIR mudar, esta conta muda junto.
const WORKER_PATH = path.join(process.cwd(), "lib", "parse-spreadsheet-worker.ts");

type WorkerOutput = { ok: true; rows: string[][] } | { ok: false; error: string };

export function spreadsheetParseFailure(error: unknown): { status: number; message: string } | null {
  if (!(error instanceof Error)) return null;
  switch (error.message) {
    case "SPREADSHEET_BUSY":
      return { status: 503, message: "Muitas planilhas estão sendo analisadas. Tente novamente em instantes." };
    case "SPREADSHEET_MAX_ROWS":
      return { status: 400, message: "A planilha passa do limite de linhas permitido." };
    case "SPREADSHEET_MAX_COLUMNS":
      return { status: 400, message: "A planilha tem colunas demais para importar." };
    case "SPREADSHEET_CELL_TOO_LARGE":
    case "SPREADSHEET_TOTAL_TEXT_TOO_LARGE":
    case "XLSX_EXPANSION_LIMIT":
      return { status: 400, message: "A planilha tem dados demais para ser processada com segurança." };
    case "INVALID_XLSX_ARCHIVE":
      return { status: 400, message: "O arquivo .xlsx é inválido ou não parece ser uma planilha do Excel." };
    case "UNSUPPORTED_SPREADSHEET_TYPE":
      return { status: 400, message: "Envie um arquivo .csv ou .xlsx." };
    default:
      return null;
  }
}

export async function parseSpreadsheet(buffer: Buffer, filename: string, options: SpreadsheetParseOptions = DEFAULT_LIMITS): Promise<string[][]> {
  const limits: WorkerLimits = {
    ...DEFAULT_LIMITS,
    ...options,
  };
  const lowerFilename = filename.toLowerCase();
  if (lowerFilename.endsWith(".xls")) throw new SpreadsheetParseError("XLS_NOT_SUPPORTED");
  if (!lowerFilename.endsWith(".csv") && !lowerFilename.endsWith(".xlsx")) throw new SpreadsheetParseError("UNSUPPORTED_SPREADSHEET_TYPE");
  if (lowerFilename.endsWith(".xlsx")) validateXlsxArchive(buffer);

  const release = await acquireParser();
  try {
    return await parseInWorker(buffer, filename, limits);
  } finally {
    release();
  }
}

function parseInWorker(buffer: Buffer, filename: string, limits: WorkerLimits): Promise<string[][]> {
  return new Promise<string[][]>((resolve, reject) => {
    let settled = false;
    const worker = new Worker(WORKER_PATH, {
      workerData: { buffer, filename, limits },
      resourceLimits: {
        maxOldGenerationSizeMb: MAX_OLD_GENERATION_MB,
        maxYoungGenerationSizeMb: MAX_YOUNG_GENERATION_MB,
      },
    });

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate().catch(() => {});
      reject(new Error("Tempo esgotado ao ler o arquivo"));
    }, TIMEOUT_MS);

    function finish(fn: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      // Nunca espera o worker encerrar sozinho — termina explicitamente
      // (idempotente se ele já tiver saído) pra não deixar handle pendurado
      // numa requisição de longa duração num servidor que fica no ar.
      worker.terminate().catch(() => {});
      fn();
    }

    worker.on("message", (msg: WorkerOutput) => {
      if (msg.ok) finish(() => resolve(msg.rows));
      else finish(() => reject(new SpreadsheetParseError(msg.error)));
    });

    // Erro NÃO tratado dentro do worker (exceção fora do try/catch do
    // parse, ou o próprio resourceLimits matando o worker por estourar a
    // memória — é assim que um OOM de worker se manifesta aqui) — sempre
    // vira falha de leitura, nunca derruba o processo principal, que é
    // exatamente o ponto de isolar isto num worker.
    worker.on("error", () => {
      finish(() => reject(new Error("Não foi possível ler o arquivo")));
    });

    worker.on("exit", (code) => {
      if (code !== 0) finish(() => reject(new Error("Não foi possível ler o arquivo")));
    });
  });
}

export function normalizeHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}
