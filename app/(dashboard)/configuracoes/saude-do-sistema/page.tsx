import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma, prismaRaw } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { SystemHealthView, type CronStatus, type CronRunEntry, type AutomationFailure, type WebhookFailure } from "./system-health-view";

// Nome técnico → rótulo em português, na ordem em que aparecem na tela.
// Precisa bater com CRON_NAME de cada app/api/cron/*/route.ts.
const KNOWN_CRONS: { name: string; label: string }[] = [
  { name: "automations", label: "Automações" },
  { name: "campaigns", label: "Campanhas de WhatsApp" },
  { name: "webhooks", label: "Webhooks de saída" },
  { name: "whatsapp-health", label: "Checagem de WhatsApp" },
  { name: "db-backup", label: "Backup do banco" },
];

const RECENT_RUNS_LIMIT = 100;
const FAILURES_LIMIT = 20;

export default async function SaudeDoSistemaPage() {
  const session = await auth();
  // OWNER só de propósito (mais restrito que o resto de Configurações) —
  // isso é infraestrutura do deploy inteiro (todo cron aqui afeta todas as
  // organizações que usam este mesmo sistema, ver lib/cron-run.ts), não
  // dado desta organização especificamente.
  if (session?.user.role !== "OWNER") {
    redirect("/configuracoes");
  }

  const organizationId = session.user.organizationId!;

  // CronRun não tem organizationId/RLS (ver schema) — lido direto, fora de
  // runWithTenant. As outras duas (automações/webhooks) são desta
  // organização, escopadas normalmente por dentro.
  const [recentRunsRaw, automationFailuresRaw, webhookFailuresRaw] = await Promise.all([
    prismaRaw.cronRun.findMany({
      orderBy: { startedAt: "desc" },
      take: RECENT_RUNS_LIMIT,
    }),
    runWithTenant(organizationId, () =>
      prisma.automationExecution.findMany({
        where: { success: false },
        orderBy: { createdAt: "desc" },
        take: FAILURES_LIMIT,
        include: { rule: { select: { name: true } } },
      }),
    ),
    runWithTenant(organizationId, () =>
      prisma.webhookDelivery.findMany({
        where: { status: "FAILED" },
        orderBy: { createdAt: "desc" },
        take: FAILURES_LIMIT,
        include: { subscription: { select: { url: true } } },
      }),
    ),
  ]);

  const recentRuns: CronRunEntry[] = recentRunsRaw.map((r) => ({
    id: r.id,
    name: r.name,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    success: r.success,
    detail: r.detail,
  }));

  // Último run de cada cron conhecido — pra o card de status no topo. Um
  // cron que nunca rodou (nome novo, ou cron-job.org ainda não configurado)
  // aparece como "nunca rodou", não como erro.
  const cronStatuses: CronStatus[] = KNOWN_CRONS.map(({ name, label }) => ({
    name,
    label,
    lastRun: recentRuns.find((r) => r.name === name) ?? null,
  }));

  const automationFailures: AutomationFailure[] = automationFailuresRaw.map((e) => ({
    id: e.id,
    ruleName: e.rule.name,
    createdAt: e.createdAt,
    detail: e.detail,
  }));

  const webhookFailures: WebhookFailure[] = webhookFailuresRaw.map((d) => ({
    id: d.id,
    url: d.subscription.url,
    event: d.event,
    createdAt: d.createdAt,
    responseStatus: d.responseStatus,
    responseBody: d.responseBody,
  }));

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Saúde do sistema</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Última execução de cada rotina automática (crons), falhas recentes de automações e de webhooks de saída.
          Quando um cron inteiro quebra, todo Dono ativo recebe um e-mail na hora — isso aqui é pra conferir quando
          quiser, sem precisar esperar o alerta.
        </p>
      </div>
      <SystemHealthView
        cronStatuses={cronStatuses}
        recentRuns={recentRuns}
        automationFailures={automationFailures}
        webhookFailures={webhookFailures}
      />
    </div>
  );
}
