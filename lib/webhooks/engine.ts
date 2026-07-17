/**
 * Motor de entrega dos webhooks de saída — chamado pelo cron
 * (app/api/cron/webhooks/route.ts). Mesmo esqueleto de runAutomations
 * (lib/automations/engine.ts): organiza por organização, nunca entrega na
 * hora que o evento acontece (ver lib/webhooks/enqueue.ts).
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { signPayload } from "@/lib/webhooks/sign";
import { isUrlSafeToFetch } from "@/lib/webhooks/url-safety";

const MAX_ATTEMPTS = 5;
// Backoff exponencial: 1min, 5min, 30min, 2h, 6h — depois disso desiste (status FAILED).
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 6 * 60 * 60_000];
const RESPONSE_BODY_TRUNCATE = 500;
// Trava por organização por tick — evita uma organização com fila grande monopolizar o cron.
const MAX_PER_ORG_PER_TICK = 50;

async function failAttempt(id: string, previousAttempts: number, responseStatus: number | null, responseBody: string) {
  const attempts = previousAttempts + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;
  const backoffMs = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
  await prisma.webhookDelivery.update({
    where: { id },
    data: {
      attempts,
      status: exhausted ? "FAILED" : "PENDING",
      nextAttemptAt: exhausted ? undefined : new Date(Date.now() + backoffMs),
      responseStatus: responseStatus ?? undefined,
      responseBody: responseBody.slice(0, RESPONSE_BODY_TRUNCATE),
    },
  });
}

export async function runWebhookDeliveries(): Promise<{ checked: number; delivered: number; failed: number }> {
  // Organization não tem RLS — listar aqui é seguro (mesmo padrão de runAutomations/runCampaigns).
  const organizations = await prisma.organization.findMany({ select: { id: true } });

  let checked = 0;
  let delivered = 0;
  let failed = 0;

  for (const org of organizations) {
    await runWithTenant(org.id, async () => {
      const deliveries = await prisma.webhookDelivery.findMany({
        where: { status: "PENDING", nextAttemptAt: { lte: new Date() } },
        include: { subscription: true },
        take: MAX_PER_ORG_PER_TICK,
      });

      for (const delivery of deliveries) {
        checked += 1;

        if (!delivery.subscription.active) {
          await prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: { status: "FAILED", responseBody: "Assinatura desativada" },
          });
          continue;
        }

        // Re-resolve na hora da entrega, não só no cadastro (POST
        // /api/webhook-subscriptions já confere isso) — um domínio podia
        // apontar pra um IP público quando foi cadastrado e ser repontado pra
        // rede interna depois (DNS rebinding). Falha permanente, não entra
        // no backoff — a URL em si é que está errada, tentar de novo não muda isso.
        if (!(await isUrlSafeToFetch(delivery.subscription.url))) {
          await prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: { status: "FAILED", responseBody: "URL de destino não é mais um host público válido" },
          });
          failed += 1;
          continue;
        }

        const rawBody = JSON.stringify({
          event: delivery.event,
          data: delivery.payload,
          timestamp: new Date().toISOString(),
        });
        const signature = signPayload(delivery.subscription.secret, rawBody);

        try {
          const res = await fetch(delivery.subscription.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CRM-Event": delivery.event,
              "X-CRM-Delivery": delivery.id,
              "X-CRM-Signature": `sha256=${signature}`,
            },
            body: rawBody,
            signal: AbortSignal.timeout(10_000),
          });
          const bodyText = await res.text().catch(() => "");

          if (res.ok) {
            await prisma.webhookDelivery.update({
              where: { id: delivery.id },
              data: {
                status: "SUCCESS",
                attempts: { increment: 1 },
                responseStatus: res.status,
                responseBody: bodyText.slice(0, RESPONSE_BODY_TRUNCATE),
              },
            });
            delivered += 1;
          } else {
            await failAttempt(delivery.id, delivery.attempts, res.status, bodyText);
            failed += 1;
          }
        } catch (err) {
          await failAttempt(delivery.id, delivery.attempts, null, err instanceof Error ? err.message : String(err));
          failed += 1;
        }
      }
    });
  }

  return { checked, delivered, failed };
}
