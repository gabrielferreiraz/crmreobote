import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { requirePanelIntegration } from "@/lib/api/painel-access";
import { apiError, apiSuccess } from "@/lib/api/v1-response";
import { firstZodMessage } from "@/lib/api/v1-schemas";
import { checkPanelLeads, panelEligibilitySchema } from "@/lib/api/painel-lead-eligibility";
import { lastOwnerTouch } from "@/lib/lead-claim";
import { rateLimitOrResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Somente leitura: o Painel pergunta quais telefones podem ir para um consultor antes de reservá-los. A gravação confere de novo. */
export async function POST(req: Request) {
  const auth = await requirePanelIntegration(req);
  if (!auth.ok) return auth.response;
  const { access } = auth;
  const limited = rateLimitOrResponse(`apikey:${access.apiKeyId}:panel-eligibility`, 60, 60_000);
  if (limited) return limited;
  const parsed = panelEligibilitySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(firstZodMessage(parsed.error), 400);
  return runWithTenant(access.organizationId, async () => {
    try {
      // Mesmo cliente com RLS que as demais leituras; o cast é o mesmo de lib/lead-claim.ts.
      const db = prisma as unknown as Prisma.TransactionClient;
      const results = await checkPanelLeads(db, access.organizationId, parsed.data, (contactId, ownerId) => lastOwnerTouch(db, access.organizationId, contactId, ownerId));
      return apiSuccess({ results });
    } catch (error) {
      console.error("[panel-eligibility] Check failed", error);
      return apiError("Não foi possível consultar os leads agora.", 500);
    }
  });
}
