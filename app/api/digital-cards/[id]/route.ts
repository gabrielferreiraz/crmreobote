import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { slugify, ensureUniqueSlug } from "@/lib/digital-cards/slug";
import { getCardDetails } from "@/lib/digital-cards/queries";
import type { $Enums } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

const LINK_TYPES = new Set(["INSTAGRAM", "LINKEDIN", "WEBSITE", "FACEBOOK", "YOUTUBE", "OTHER"]);
const MAX_LINKS = 12;

type LinkInput = { type: string; label: string; url: string; order?: number; active?: boolean };

/**
 * Atualiza o cartão do próprio usuário — ou de um terceiro, se quem chama
 * for OWNER/MANAGER (mesma checagem já usada em
 * app/api/org/members/[userId]/avatar/route.ts pra editar avatar alheio).
 * `links` (se vier) SUBSTITUI a lista inteira — mesmo padrão já usado pras
 * ondas de RMKT (lib/use-rmkt-waves.ts): o cliente manda o array completo
 * na ordem final, mais simples que um CRUD item-a-item pra uma lista
 * pequena (no máximo 12 aqui).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { organizationId, userId, role } = access;

  return runWithTenant(organizationId, async () => {
    const card = await prisma.digitalCard.findUnique({ where: { id } });
    if (!card || card.organizationId !== organizationId) {
      return NextResponse.json({ error: "Cartão não encontrado" }, { status: 404 });
    }
    if (card.userId !== userId && !["OWNER", "MANAGER"].includes(role)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const {
      slug,
      active,
      jobTitle,
      bio,
      companyName,
      emailOverride,
      phone,
      whatsapp,
      address,
      showPortfolioValue,
      portfolioValueDisplay,
      links,
    } = body as {
      slug?: string;
      active?: boolean;
      jobTitle?: string | null;
      bio?: string | null;
      companyName?: string | null;
      emailOverride?: string | null;
      phone?: string | null;
      whatsapp?: string | null;
      address?: string | null;
      showPortfolioValue?: boolean;
      portfolioValueDisplay?: string | null;
      links?: LinkInput[];
    };

    let resolvedSlug: string | undefined;
    if (slug !== undefined) {
      const clean = slugify(slug);
      if (!clean) return NextResponse.json({ error: "Slug inválido" }, { status: 400 });
      resolvedSlug = clean === card.slug ? clean : await ensureUniqueSlug(clean, card.id);
    }

    if (Array.isArray(links)) {
      if (links.length > MAX_LINKS) {
        return NextResponse.json({ error: `Máximo de ${MAX_LINKS} links` }, { status: 400 });
      }
      for (const link of links) {
        if (!LINK_TYPES.has(link.type)) return NextResponse.json({ error: "Tipo de link inválido" }, { status: 400 });
        if (!link.label?.trim() || !link.url?.trim()) {
          return NextResponse.json({ error: "Cada link precisa de título e URL" }, { status: 400 });
        }
        try {
          new URL(link.url);
        } catch {
          return NextResponse.json({ error: `URL inválida: ${link.url}` }, { status: 400 });
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.digitalCard.update({
        where: { id },
        data: {
          ...(resolvedSlug !== undefined ? { slug: resolvedSlug } : {}),
          ...(active !== undefined ? { active } : {}),
          ...(jobTitle !== undefined ? { jobTitle } : {}),
          ...(bio !== undefined ? { bio } : {}),
          ...(companyName !== undefined ? { companyName } : {}),
          ...(emailOverride !== undefined ? { emailOverride } : {}),
          ...(phone !== undefined ? { phone } : {}),
          ...(whatsapp !== undefined ? { whatsapp } : {}),
          ...(address !== undefined ? { address } : {}),
          ...(showPortfolioValue !== undefined ? { showPortfolioValue } : {}),
          ...(portfolioValueDisplay !== undefined ? { portfolioValueDisplay } : {}),
        },
      });

      if (Array.isArray(links)) {
        await tx.digitalCardLink.deleteMany({ where: { cardId: id } });
        if (links.length > 0) {
          await tx.digitalCardLink.createMany({
            data: links.map((l, i) => ({
              cardId: id,
              type: l.type as $Enums.DigitalCardLinkType,
              label: l.label.trim(),
              url: l.url.trim(),
              order: l.order ?? i,
              active: l.active ?? true,
            })),
          });
        }
      }
    });

    const updated = await getCardDetails(id);
    return NextResponse.json(updated);
  });
}
