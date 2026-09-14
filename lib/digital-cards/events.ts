import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import type { $Enums, Prisma } from "@/app/generated/prisma/client";

/**
 * Grava 1 evento de analytics do cartão — sempre chamado DEPOIS que
 * organizationId já foi resolvido (pela página pública, via
 * runWithCardSlugLookup uma única vez — ver app/c/[slug]/page.tsx), então
 * aqui já usamos runWithTenant normal, sem bootstrap nenhum (ver comentário
 * no schema, model DigitalCardEvent). Fire-and-forget em quem chama (nunca
 * atrasa a resposta ao visitante por causa de uma métrica) — mesmo espírito
 * de "não afeta a ação principal" já usado em outros logs do sistema.
 */
export async function recordCardEvent(
  organizationId: string,
  cardId: string,
  eventType: $Enums.DigitalCardEventType,
  opts?: { sessionId?: string | null; source?: string | null; metadata?: Prisma.InputJsonValue },
): Promise<void> {
  await runWithTenant(organizationId, () =>
    prisma.digitalCardEvent.create({
      data: {
        organizationId,
        cardId,
        eventType,
        sessionId: opts?.sessionId ?? null,
        source: opts?.source ?? null,
        metadata: opts?.metadata,
      },
    }),
  );
}
