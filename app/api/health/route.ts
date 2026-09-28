import { NextResponse } from "next/server";
import fs from "fs";
import { prismaRaw } from "@/lib/prisma";
import { getCronStaleness } from "@/lib/cron-watchdog";

export const dynamic = "force-dynamic";

// Mesmos crons e tolerâncias do watchdog (lib/cron-watchdog.ts).
const WATCHED_CRONS = [
  { name: "campaigns", maxStaleMinutes: 10 },
  { name: "automations", maxStaleMinutes: 10 },
  { name: "webhooks", maxStaleMinutes: 10 },
];

/**
 * Dois modos, de propósito:
 *
 *  - GET /api/health (padrão): só "o processo está de pé" + carimbo do build.
 *    NÃO toca no banco — o EasyPanel já entrou em loop de reinício quando um
 *    healthcheck falhava (ver Dockerfile), e um Postgres lento por 2 segundos
 *    não é motivo pra matar o container.
 *
 *  - GET /api/health?deep=1: pra MONITOR EXTERNO (UptimeRobot, cron-job.org).
 *    Checa o banco de verdade (com tempo de resposta) e se os crons que movem
 *    campanha/automação/webhook estão rodando. Responde 503 se algo crítico
 *    falhou — é o que o monitor precisa pra alertar. Auditoria 09/2026: antes
 *    o health dizia "ok" com o banco fora do ar.
 *
 * Nunca devolve detalhe interno (mensagem de erro, host, versão): só sim/não.
 */
export async function GET(req: Request) {
  let builtAt: string | null = null;
  try {
    builtAt = fs.readFileSync("/app/BUILD_TIME.txt", "utf8").trim();
  } catch {
    builtAt = null;
  }

  const deep = new URL(req.url).searchParams.get("deep") === "1";
  if (!deep) return NextResponse.json({ ok: true, builtAt });

  const started = Date.now();
  let database = false;
  try {
    await Promise.race([
      prismaRaw.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);
    database = true;
  } catch {
    database = false;
  }
  const databaseMs = Date.now() - started;

  // Crons só dá pra checar com o banco de pé (o registro dos ticks está nele).
  const crons = database
    ? await Promise.all(
        WATCHED_CRONS.map(async (c) => {
          const s = await getCronStaleness(c.name, c.maxStaleMinutes).catch(() => null);
          return { name: c.name, ok: !!s && !s.stale, minutesSinceLastRun: s?.minutesSinceLastRun != null ? Math.round(s.minutesSinceLastRun) : null };
        }),
      )
    : [];

  const ok = database && crons.every((c) => c.ok);
  return NextResponse.json({ ok, builtAt, database, databaseMs, crons }, { status: ok ? 200 : 503 });
}
