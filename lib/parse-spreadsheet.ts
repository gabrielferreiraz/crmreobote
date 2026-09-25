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
// 5MB/5000 linhas já aplicado nas rotas (ver MAX_FILE_SIZE/MAX_ROWS em
// app/api/contacts/import e app/api/deals/import) — um .xlsx legítimo desse
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

// process.cwd() (não __dirname do arquivo compilado, que muda de lugar
// dentro do bundle do Next) — em produção é /app (WORKDIR do Dockerfile,
// que copia lib/ inteira pra lá de propósito, exatamente pra este caminho
// existir), em dev é a raiz do projeto (de onde `npm run dev` roda). Se um
// dia o WORKDIR mudar, esta conta muda junto.
const WORKER_PATH = path.join(process.cwd(), "lib", "parse-spreadsheet-worker.ts");

type WorkerOutput = { ok: true; rows: string[][] } | { ok: false; error: string };

export async function parseSpreadsheet(buffer: Buffer, filename: string): Promise<string[][]> {
  return new Promise<string[][]>((resolve, reject) => {
    let settled = false;
    const worker = new Worker(WORKER_PATH, {
      workerData: { buffer, filename },
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
      else finish(() => reject(new Error(msg.error)));
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
