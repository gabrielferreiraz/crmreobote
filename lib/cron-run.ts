import { prismaRaw } from "@/lib/prisma";
import { sendSystemAlert } from "@/lib/system-alerts";
import { escapeHtml } from "@/lib/security/html-escape";
import { acquireCronLock } from "@/lib/cron-lock";

const ALERT_COOLDOWN_MS = 15 * 60_000;
const DETAIL_MAX_LENGTH = 2000;

function summarize(result: unknown): string | null {
  if (result === undefined) return null;
  try {
    const json = JSON.stringify(result);
    if (!json) return null;
    return json.length > DETAIL_MAX_LENGTH ? `${json.slice(0, DETAIL_MAX_LENGTH)}…` : json;
  } catch {
    return null;
  }
}

/**
 * true se este cron merece um e-mail agora — sempre na 1ª falha depois de
 * uma sequência de sucessos (mudou de estado, alguém precisa saber), só de
 * novo depois de ALERT_COOLDOWN_MS se continuar quebrado (senão um cron
 * travado falhando a cada 1-2min vira spam de e-mail).
 */
async function shouldAlert(name: string): Promise<boolean> {
  const last = await prismaRaw.cronRun.findFirst({
    where: { name },
    orderBy: { startedAt: "desc" },
    select: { success: true, startedAt: true },
  });
  if (!last || last.success) return true;
  return Date.now() - last.startedAt.getTime() > ALERT_COOLDOWN_MS;
}

/**
 * Envolve o corpo inteiro de um cron: grava toda execução (sucesso/falha/
 * detalhe) em CronRun — alimenta a página "Saúde do sistema" (Configurações,
 * OWNER-only) — e manda e-mail pra todo Dono (ver lib/system-alerts.ts) só
 * quando o TICK INTEIRO falha (erro não tratado escapando de `fn`), nunca
 * por uma falha pontual de uma automação/webhook específico — isso já tem
 * histórico próprio (ver lib/automations/history.ts e WebhookDelivery),
 * alertar aqui por CADA falha individual seria ruído demais.
 */
export async function recordCronRun<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = new Date();
  try {
    const result = await fn();
    await prismaRaw.cronRun
      .create({ data: { name, startedAt, finishedAt: new Date(), success: true, detail: summarize(result) } })
      .catch((err) => console.error(`[cron-run] falha ao gravar execução de "${name}"`, err));
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const alert = await shouldAlert(name).catch(() => true);

    await prismaRaw.cronRun
      .create({
        data: { name, startedAt, finishedAt: new Date(), success: false, detail: message.slice(0, DETAIL_MAX_LENGTH) },
      })
      .catch((e) => console.error(`[cron-run] falha ao gravar falha de "${name}"`, e));

    if (alert) {
      await sendSystemAlert(
        `🔴 Cron "${name}" falhou`,
        `<p>O cron <strong>${escapeHtml(name)}</strong> falhou:</p><pre style="white-space:pre-wrap;font-family:monospace">${escapeHtml(message)}</pre><p>Ver histórico completo em Configurações → Saúde do sistema.</p>`,
      );
    }

    throw err;
  }
}

/**
 * Padrão comum aos 4 crons de app/api/cron/*: adquire o lock, roda, libera
 * mesmo em erro, tudo gravado por recordCronRun. Extraído aqui pra poder
 * ser chamado tanto pela rota dedicada de um cron (via cron-job.org) QUANTO
 * como BACKSTOP de dentro de outro cron mais confiável — ver `runCronTick`
 * em app/api/cron/automations/route.ts, que agora também dispara
 * campaigns/webhooks por aqui.
 *
 * Por quê o backstop existe: cron-job.org (serviço externo, fora do nosso
 * controle) já desativou/removeu jobs sozinho duas vezes neste projeto —
 * "campaigns" ficou 6 dias parado em 2026-08, e de novo "campaigns" +
 * "webhooks" ficaram parados por dias em 2026-09 (webhooks nunca chegou a
 * rodar uma vez) — nos dois casos SEM nenhuma falha registrada, porque a
 * requisição simplesmente parou de chegar, não é algo que o código consiga
 * detectar sozinho a partir de dentro da própria rota. `checkStaleCrons`
 * (lib/cron-watchdog.ts) alerta quando isso acontece, mas alertar não
 * mantém o negócio rodando enquanto ninguém conserta o painel do
 * cron-job.org. O lock por nome (acquireCronLock) garante que rodar o
 * mesmo cron duas vezes (a rota dedicada E o backstop, ou dois backstops)
 * nunca vira processamento duplicado — o segundo sempre acha o lock preso
 * e sai com `{ skipped: true }`.
 */
export async function runLockedCron<T>(name: string, fn: () => Promise<T>): Promise<T | { skipped: true }> {
  return recordCronRun(name, async () => {
    const lock = await acquireCronLock(name);
    if (!lock) return { skipped: true } as const;
    try {
      return await fn();
    } finally {
      await lock.release().catch((err) => console.error(`[cron:${name}] falha ao liberar lock`, err));
    }
  });
}
