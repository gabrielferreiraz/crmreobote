/**
 * Backup do Postgres inteiro (pg_dump em formato custom) direto pro bucket
 * `crm-backups` do R2 — separado do bucket de mídia do WhatsApp de propósito
 * (esse é privado, aquele é público) e com credencial própria
 * (R2_BACKUP_*), pra um vazamento de uma nunca comprometer a outra.
 *
 * Usa DATABASE_URL (a mesma conexão de migração), não DATABASE_URL_APP: essa
 * é a que tem privilégio pra ler todas as tabelas sem passar pelas policies
 * de RLS (RLS só restringe quem não é dono da tabela) — um dump rodado pela
 * conexão de app poderia sair incompleto dependendo do contexto de tenant no
 * momento da chamada.
 *
 * Duas correções da auditoria de 09/2026:
 *  - MEMÓRIA: o dump era montado INTEIRO num Buffer (até 500 MB) antes do
 *    upload, dentro do mesmo processo que atende o CRM. Agora o pg_dump grava
 *    num arquivo temporário e o upload lê esse arquivo em stream — o consumo
 *    de memória fica constante, seja qual for o tamanho do banco.
 *  - SENHA: a URL completa (com a senha do banco) ia como ARGUMENTO do
 *    pg_dump — visível em `ps` pra qualquer processo do container. Agora vai
 *    por variável de ambiente (PGPASSWORD etc.), que só o próprio processo lê.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// Folga generosa pro tamanho atual do banco — o teto de tamanho só existe
// pra um dump anômalo não encher o disco/bucket sem ninguém perceber.
const DUMP_TIMEOUT_MS = 10 * 60_000;
const MAX_DUMP_BYTES = 2 * 1024 * 1024 * 1024;

export type DbBackupResult = { key: string; bytes: number };

/** Parâmetros de conexão do libpq a partir da URL — nunca a URL inteira na linha de comando. */
function pgEnvFromUrl(databaseUrl: string): Record<string, string | undefined> {
  const url = new URL(databaseUrl);
  const sslmode = url.searchParams.get("sslmode");
  return {
    PATH: process.env.PATH,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
    ...(sslmode ? { PGSSLMODE: sslmode } : {}),
  };
}

function runPgDump(outFile: string, env: Record<string, string | undefined>): Promise<void> {
  return new Promise((resolve, reject) => {
    // --format=custom: comprimido e restaurável seletivamente com pg_restore
    // (ao contrário do --format=plain, que é só um .sql cru).
    const child = spawn("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", outFile], { env: env as NodeJS.ProcessEnv });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`pg_dump passou de ${DUMP_TIMEOUT_MS / 60_000} minutos — abortado`));
    }, DUMP_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`pg_dump saiu com código ${code}: ${stderr.trim().slice(0, 500)}`));
    });
  });
}

export async function runDbBackup(): Promise<DbBackupResult> {
  const databaseUrl = process.env.DATABASE_URL;
  const accountId = process.env.R2_BACKUP_ACCOUNT_ID;
  const bucket = process.env.R2_BACKUP_BUCKET_NAME;
  const accessKeyId = process.env.R2_BACKUP_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_BACKUP_SECRET_ACCESS_KEY;
  if (!databaseUrl || !accountId || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Backup do banco não configurado (variáveis R2_BACKUP_*/DATABASE_URL ausentes)");
  }

  const tmpFile = path.join(os.tmpdir(), `crm-backup-${process.pid}-${Date.now()}.dump`);
  try {
    await runPgDump(tmpFile, pgEnvFromUrl(databaseUrl));

    const { size } = await fs.promises.stat(tmpFile);
    if (size === 0) throw new Error("pg_dump gerou um arquivo vazio");
    if (size > MAX_DUMP_BYTES) throw new Error(`Dump com ${size} bytes passa do teto de ${MAX_DUMP_BYTES} — não enviado`);

    const client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });

    const key = `postgres/${new Date().toISOString().replace(/[:.]/g, "-")}.dump`;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        // Stream do arquivo (não Buffer) + ContentLength: o SDK envia sem
        // carregar o dump inteiro na memória.
        Body: fs.createReadStream(tmpFile),
        ContentLength: size,
        ContentType: "application/octet-stream",
      }),
    );

    console.log(`[db-backup] backup salvo (${size} bytes)`);
    return { key, bytes: size };
  } finally {
    await fs.promises.unlink(tmpFile).catch(() => {});
  }
}
