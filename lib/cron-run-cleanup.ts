import { prismaRaw } from "@/lib/prisma";

/** Quanto tempo o histórico de execuções dos crons fica guardado. */
export const CRON_RUN_RETENTION_DAYS = 30;
/** Linhas apagadas por comando: lote pequeno, nunca trava a tabela por muito tempo. */
const BATCH_SIZE = 5_000;
/** Teto por chamada: zera o acúmulo antigo em poucas horas sem pesar num tick só. */
const MAX_BATCHES = 6;

/**
 * Retenção de CronRun. Cada tick de cron grava uma linha (vários crons a cada
 * 1-2 min), e nada apagava: eram 518 mil linhas e 170 MB em 27/11/2026,
 * crescendo ~5 mil por dia. Quem lê só precisa do recente: a tela "Saúde do
 * sistema" mostra as últimas 100 e o watchdog (lib/cron-watchdog.ts) só olha a
 * última execução de cada cron.
 *
 * CronRun não tem organizationId nem RLS, por isso o prismaRaw direto.
 */
export async function purgeOldCronRuns(): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - CRON_RUN_RETENTION_DAYS * 86_400_000);
  let deleted = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const count = await prismaRaw.$executeRaw`
      DELETE FROM "CronRun"
      WHERE id IN (SELECT id FROM "CronRun" WHERE "startedAt" < ${cutoff} LIMIT ${BATCH_SIZE})`;
    deleted += count;
    if (count < BATCH_SIZE) break;
  }
  return { deleted };
}
