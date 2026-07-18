/**
 * Presença ("está online agora") e atividade diária ("tempo no CRM" +
 * "quantas alterações") — as duas vêm da mesma fonte: um heartbeat que o
 * navegador manda a cada 30s enquanto a aba está em primeiro plano (ver
 * components/presence-heartbeat.tsx). Online é só o `lastActiveAt` recente
 * (em OrganizationUser); tempo/alterações viram um rollup por dia em
 * UserDailyActivity, não um log de eventos — muito mais barato de manter e
 * de agregar num relatório por período.
 */

import { prisma, prismaRaw } from "@/lib/prisma";
import { setTenantOnTx } from "@/lib/tenant-context";
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
  const date = brazilDateKey(now);

  // Ler o lastActiveAt anterior e gravar o novo precisa ser UMA operação
  // atômica, não dois passos separados (findUnique + update): se a mesma
  // pessoa tiver duas abas do CRM abertas ao mesmo tempo, dois heartbeats
  // quase simultâneos podiam ler o mesmo lastActiveAt antigo antes que o
  // primeiro gravasse o novo, e cada um somava seu próprio delta sobre o
  // mesmo intervalo — contando o mesmo tempo duas vezes. O `FOR UPDATE` na
  // CTE trava a linha: o segundo heartbeat só lê depois que o primeiro já
  // commitou. Precisa ser `prismaRaw` + `setTenantOnTx` (não o `prisma` com
  // RLS automático) porque a extensão de RLS só envolve operações de
  // modelo, não `$queryRaw` — chamado direto em `prisma`, o SET LOCAL nunca
  // seria aplicado e a RLS filtraria a query inteira em silêncio (ver
  // lib/prisma.ts).
  await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);

    const rows = await tx.$queryRaw<{ previousActiveAt: Date | null }[]>`
      WITH prev AS (
        SELECT "lastActiveAt"
        FROM "OrganizationUser"
        WHERE "organizationId" = ${organizationId} AND "userId" = ${userId}
        FOR UPDATE
      )
      UPDATE "OrganizationUser" AS ou
      SET "lastActiveAt" = ${now}
      FROM prev
      WHERE ou."organizationId" = ${organizationId} AND ou."userId" = ${userId}
      RETURNING prev."lastActiveAt" AS "previousActiveAt"
    `;
    const previousActiveAt = rows[0]?.previousActiveAt ?? null;

    const gapMs = previousActiveAt ? now.getTime() - previousActiveAt.getTime() : 0;
    const activeDeltaSeconds = gapMs > 0 ? Math.round(Math.min(gapMs, MAX_HEARTBEAT_GAP_MS) / 1000) : 0;
    if (activeDeltaSeconds === 0) return;

    await tx.userDailyActivity.upsert({
      where: { organizationId_userId_date: { organizationId, userId, date } },
      create: { organizationId, userId, date, activeSeconds: activeDeltaSeconds },
      update: { activeSeconds: { increment: activeDeltaSeconds } },
    });
  });
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
