/**
 * Presença ("está online agora") e atividade diária ("tempo no CRM" +
 * "quantas alterações") — as duas vêm da mesma fonte: um heartbeat que o
 * navegador manda a cada 30s enquanto a aba está em primeiro plano (ver
 * components/presence-heartbeat.tsx). Online é só o `lastActiveAt` recente
 * (em OrganizationUser); tempo/alterações viram um rollup por dia em
 * UserDailyActivity, não um log de eventos — muito mais barato de manter e
 * de agregar num relatório por período.
 */

import { prisma } from "@/lib/prisma";
import { brazilDateKey } from "@/lib/timezone";

/** "Online agora" = heartbeat nos últimos 2 minutos (4x o intervalo de 30s do cliente). */
export const ONLINE_THRESHOLD_MS = 2 * 60_000;

/**
 * Só conta o intervalo entre este heartbeat e o anterior como "tempo ativo"
 * se o anterior foi recente (a aba ficou aberta e em foco o tempo todo).
 * Sem esse teto, reabrir o CRM depois de uma noite de folga somaria a noite
 * inteira como "uso ativo" — 3x o intervalo do heartbeat (90s) é folga
 * suficiente pra uma reconexão de rede sem cortar tempo de verdade.
 */
const MAX_HEARTBEAT_GAP_MS = 90_000;

export async function recordHeartbeat(organizationId: string, userId: string): Promise<void> {
  const now = new Date();
  const membership = await prisma.organizationUser.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { lastActiveAt: true },
  });

  const gapMs = membership?.lastActiveAt ? now.getTime() - membership.lastActiveAt.getTime() : 0;
  const activeDeltaSeconds = gapMs > 0 ? Math.round(Math.min(gapMs, MAX_HEARTBEAT_GAP_MS) / 1000) : 0;

  const date = brazilDateKey(now);
  await Promise.all([
    prisma.organizationUser.update({
      where: { organizationId_userId: { organizationId, userId } },
      data: { lastActiveAt: now },
    }),
    activeDeltaSeconds > 0
      ? prisma.userDailyActivity.upsert({
          where: { organizationId_userId_date: { organizationId, userId, date } },
          create: { organizationId, userId, date, activeSeconds: activeDeltaSeconds },
          update: { activeSeconds: { increment: activeDeltaSeconds } },
        })
      : Promise.resolve(),
  ]);
}

/**
 * Chamar sempre sem `await` nos call sites (mutações de Cliente/Negócio/
 * Tarefa), com `.catch(...)` — mesmo padrão já usado em
 * lib/webhooks/enqueue.ts's enqueueWebhookEvent. Nunca pode derrubar a
 * mutação principal por causa de uma contagem de relatório.
 */
export async function recordUserChange(organizationId: string, userId: string): Promise<void> {
  const date = brazilDateKey(new Date());
  await prisma.userDailyActivity.upsert({
    where: { organizationId_userId_date: { organizationId, userId, date } },
    create: { organizationId, userId, date, changeCount: 1 },
    update: { changeCount: { increment: 1 } },
  });
}
