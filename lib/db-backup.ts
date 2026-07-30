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
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const execFileAsync = promisify(execFile);

// Banco pesa ~20MB hoje — folga generosa (5min/500MB) pra sobrar bastante
// margem de crescimento sem precisar mexer nisso de novo tão cedo.
const DUMP_TIMEOUT_MS = 5 * 60_000;
const MAX_DUMP_BYTES = 500 * 1024 * 1024;

export type DbBackupResult = { key: string; bytes: number };

export async function runDbBackup(): Promise<DbBackupResult> {
  const databaseUrl = process.env.DATABASE_URL;
  const accountId = process.env.R2_BACKUP_ACCOUNT_ID;
  const bucket = process.env.R2_BACKUP_BUCKET_NAME;
  const accessKeyId = process.env.R2_BACKUP_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_BACKUP_SECRET_ACCESS_KEY;
  if (!databaseUrl || !accountId || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Backup do banco não configurado (variáveis R2_BACKUP_*/DATABASE_URL ausentes)");
  }

  // --format=custom: comprimido e restaurável seletivamente com pg_restore
  // (ao contrário do --format=plain, que é só um .sql cru).
  const { stdout } = await execFileAsync("pg_dump", ["--format=custom", "--no-owner", "--no-acl", databaseUrl], {
    encoding: "buffer",
    maxBuffer: MAX_DUMP_BYTES,
    timeout: DUMP_TIMEOUT_MS,
  });

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const key = `postgres/${new Date().toISOString().replace(/[:.]/g, "-")}.dump`;
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: stdout, ContentType: "application/octet-stream" }),
  );

  console.log(`[db-backup] backup salvo: ${key} (${stdout.length} bytes)`);
  return { key, bytes: stdout.length };
}
