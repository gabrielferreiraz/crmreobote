import { prismaRaw } from "@/lib/prisma";
import { sendSystemAlert } from "@/lib/system-alerts";
import { escapeHtml } from "@/lib/security/html-escape";

type WatchedCron = { name: string; maxStaleMinutes: number };

// Crons que deveriam rodar a cada 1-2min via cron-job.org (ver comentário em
// cada app/api/cron/*/route.ts). Não inclui "whatsapp-health" (quem roda
// este watchdog — checar a si mesmo nunca pega o caso que mais importa, que
// é ELE parar de rodar) nem "db-backup" (diário, não atrasa por minutos).
const WATCHED_CRONS: WatchedCron[] = [
  { name: "campaigns", maxStaleMinutes: 10 },
  { name: "automations", maxStaleMinutes: 10 },
  { name: "webhooks", maxStaleMinutes: 10 },
];

const ALERT_COOLDOWN_MS = 6 * 60 * 60_000;

// Evita mandar e-mail de novo a cada 1-2min enquanto o problema persiste — só
// na 1ª detecção e depois a cada ALERT_COOLDOWN_MS. Guardado em memória do
// processo (não em CronRun, que é justamente o dado que gera o alerta) —
// suficiente pra evitar spam dentro da vida de uma mesma instância; num
// redeploy, o pior caso é um e-mail extra.
const lastAlertedAt = new Map<string, number>();

/**
 * Detecta quando outro cron parou de ser chamado de verdade pelo cron-job.org
 * (job desativado no painel deles, deletado, ou uma falha antes do
 * try/catch de recordCronRun escapando como 500 puro — ver comentário em
 * lib/cron-lock.ts sobre isso) — diferente de recordCronRun, que só alerta
 * quando o TICK CHEGA A RODAR e falha. Se o cron-job.org simplesmente parar
 * de chamar a rota, nenhuma execução nunca chega a ser gravada, e sem isto
 * aqui o problema fica invisível indefinidamente — foi exatamente o que
 * aconteceu com "campaigns" em 2026-08: parou de rodar por 6 dias sem
 * nenhum alerta, porque nunca houve uma falha REGISTRADA pra alertar sobre.
 */
export async function checkStaleCrons(): Promise<{ name: string; minutesSinceLastRun: number | null }[]> {
  const stale: { name: string; minutesSinceLastRun: number | null }[] = [];

  for (const watched of WATCHED_CRONS) {
    const last = await prismaRaw.cronRun.findFirst({
      where: { name: watched.name },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    });

    const minutesSinceLastRun = last ? (Date.now() - last.startedAt.getTime()) / 60_000 : null;
    const isStale = minutesSinceLastRun === null || minutesSinceLastRun > watched.maxStaleMinutes;
    if (!isStale) continue;

    stale.push({ name: watched.name, minutesSinceLastRun });

    const lastAlert = lastAlertedAt.get(watched.name);
    if (lastAlert && Date.now() - lastAlert < ALERT_COOLDOWN_MS) continue;
    lastAlertedAt.set(watched.name, Date.now());

    const description =
      minutesSinceLastRun === null
        ? "nunca registrou nenhuma execução"
        : `sem executar há ${Math.round(minutesSinceLastRun)} minutos`;
    await sendSystemAlert(
      `🔴 Cron "${watched.name}" parou de rodar`,
      `<p>O cron <strong>${escapeHtml(watched.name)}</strong> ${escapeHtml(description)} (esperado a cada 1-2min).</p>` +
        `<p>Provavelmente o job foi desativado ou removido no cron-job.org — confira o painel de lá e reative/recrie apontando pra <code>/api/cron/${escapeHtml(watched.name)}</code> com o mesmo header usado nos outros jobs.</p>`,
    );
  }

  return stale;
}
