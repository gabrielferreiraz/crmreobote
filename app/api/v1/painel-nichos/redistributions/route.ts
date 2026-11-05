import { after } from "next/server";
import { prisma, prismaRaw } from "@/lib/prisma";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { requirePanelIntegration } from "@/lib/api/painel-access";
import { apiSuccess, apiError } from "@/lib/api/v1-response";
import { firstZodMessage } from "@/lib/api/v1-schemas";
import { PanelRedistributionError, panelRedistributionSchema, redistributeExistingDeal } from "@/lib/api/painel-redistribution";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { publishDealsEvent } from "@/lib/deals/live-events";
import { enqueueWebhookEvent, buildDealWebhookPayload } from "@/lib/webhooks/enqueue";
import { linkOrphanThreadsForContact } from "@/lib/whatsapp/threads";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requirePanelIntegration(req);
  if (!auth.ok) return auth.response;
  const { access } = auth;
  const limited = rateLimitOrResponse(`apikey:${access.apiKeyId}:panel-redistribution`, 30, 60_000);
  if (limited) return limited;
  const parsed = panelRedistributionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(firstZodMessage(parsed.error), 400);

  return runWithTenant(access.organizationId, async () => {
    try {
      const result = await prismaRaw.$transaction(async tx => {
        await setTenantOnTx(tx, access.organizationId);
        return redistributeExistingDeal(tx, access.organizationId, access.apiKeyName, parsed.data);
      }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 15_000 });
      if (!result.replayed) {
        after(async () => {
          try {
            await runWithTenant(access.organizationId, async () => {
              publishDealsEvent(access.organizationId, { type: result.before ? "deal-updated" : "deal-created", pipelineId: result.after.pipelineId });
              const deal = await prisma.deal.findFirst({ where: { id: result.id, organizationId: access.organizationId }, include: { contact: true, owner: true, stage: true } });
              if (!deal) return;
              const payload = await buildDealWebhookPayload(deal);
              if (!result.before) {
                if (result.contactCreated) {
                  const { contact } = deal;
                  await linkOrphanThreadsForContact(access.organizationId, contact.id, [contact.phoneNormalized, contact.whatsappNormalized]);
                  await enqueueWebhookEvent(access.organizationId, "contact.created", {
                    id: contact.id, name: contact.name, email: contact.email, phone: contact.phone, whatsapp: contact.whatsapp, source: contact.source, tags: contact.tags, createdAt: contact.createdAt,
                  });
                }
                await enqueueWebhookEvent(access.organizationId, "deal.created", payload);
                return;
              }
              if (result.before.ownerId !== result.after.ownerId) await enqueueWebhookEvent(access.organizationId, "deal.owner_changed", { ...payload, previousOwner: { id: result.before.ownerId } });
              if (result.before.stageId !== result.after.stageId) await enqueueWebhookEvent(access.organizationId, "deal.stage_changed", { ...payload, previousStage: { id: result.before.stageId } });
              if (result.before.contactOwnerId !== result.after.contactOwnerId) await enqueueWebhookEvent(access.organizationId, "contact.owner_changed", {
                id: result.contactId, name: deal.contact.name, previousOwnerId: result.before.contactOwnerId, ownerId: result.after.contactOwnerId,
              });
            });
          } catch (error) { console.error("[panel-redistribution] Notifications failed after commit", error); }
        });
      }
      return apiSuccess(result);
    } catch (error) {
      if (error instanceof PanelRedistributionError) return apiError(error.message, error.status, [{ code: error.code }]);
      if (error && typeof error === "object" && "code" in error && error.code === "P2034") {
        return apiError("O cadastro mudou durante a redistribuição. Confira o estado atual antes de reenviar.", 409);
      }
      console.error("[panel-redistribution] Transaction rolled back", error);
      return apiError("Não foi possível concluir a redistribuição. Confira a auditoria usando o identificador da solicitação.", 500);
    }
  });
}
