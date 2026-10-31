import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveContactPhones } from "@/lib/phone-normalize";
import { findDuplicateContact, buildConflictPayload, isConflictLookupThrottled } from "@/lib/contact-duplicate";

export const dynamic = "force-dynamic";

/**
 * Verificação SILENCIOSA de duplicidade pra Lista dos 50 — chamada no blur
 * do campo WhatsApp de cada linha (nunca enquanto a pessoa ainda está
 * digitando), reaproveitando a MESMA checagem/regra de "Assumir lead" que
 * POST/PUT /api/contacts já usa (ver lib/contact-duplicate.ts e
 * lib/lead-claim.ts) — não existe uma regra separada pra isto.
 *
 * Sempre responde 200 com `duplicate: false` quando não há nada pra avisar
 * (sem duplicata, lead já é do próprio consultor, ou o freio de 40
 * consultas/hora — lib/contact-duplicate.ts — foi atingido): o ponto desta
 * rota é nunca interromper o preenchimento à toa, então o cliente nunca
 * precisa tratar um caso de erro aqui, só "tem algo pra mostrar ou não".
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const whatsapp = searchParams.get("whatsapp");

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(access.organizationId, async () => {
    const phones = resolveContactPhones({ whatsapp });
    if (!phones.whatsappNormalized) return NextResponse.json({ duplicate: false });

    const duplicate = await findDuplicateContact(access.organizationId, null, phones.whatsappNormalized);
    if (!duplicate) return NextResponse.json({ duplicate: false });

    // O freio (lib/contact-duplicate.ts) só consome orçamento quando UMA
    // duplicata de verdade foi achada (mesma ordem de POST /api/contacts) —
    // é o que revela nome/responsável de outro contato, não a checagem em si.
    if (isConflictLookupThrottled(access.userId)) return NextResponse.json({ duplicate: false });

    const conflict = buildConflictPayload(duplicate, access.userId);
    if (conflict.ownedByMe) return NextResponse.json({ duplicate: false });

    // Só pra DAR CONTEXTO no modal ("esse negócio de 2025 tá parado") — não
    // entra em nenhuma decisão de permissão; quem decide se pode assumir
    // continua sendo exclusivamente lib/lead-claim.ts, sempre reconferido de
    // novo no servidor quando o consultor de fato clicar em assumir/pedir
    // (POST /api/lead-requests nunca confia neste payload). De propósito SEM
    // `value`: diferente de nome/responsável (que POST /api/contacts já
    // revelava em qualquer duplicidade), o valor do negócio é informação
    // financeira/comissão de outro consultor — não é preciso pra decidir
    // assumir ou pedir, então nunca sai daqui.
    const deal = await prisma.deal.findFirst({
      where: { organizationId: access.organizationId, contactId: duplicate.contactId },
      orderBy: { updatedAt: "desc" },
      select: {
        name: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        stage: { select: { name: true } },
      },
    });

    return NextResponse.json({
      duplicate: true,
      contact: { id: conflict.contactId, name: conflict.contactName },
      responsavelName: conflict.responsavelName,
      claimable: conflict.claimable,
      claimReason: conflict.claimReason,
      requestable: conflict.requestable,
      lostAt: conflict.lostAt,
      deal: deal
        ? {
            name: deal.name,
            status: deal.status,
            stageName: deal.stage.name,
            createdAt: deal.createdAt,
            updatedAt: deal.updatedAt,
          }
        : null,
    });
  });
}
