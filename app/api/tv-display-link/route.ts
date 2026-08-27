import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { generateTvDisplayLinkToken } from "@/lib/tv-display-link";
import { logAudit } from "@/lib/audit-log";
import { getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// OWNER/MANAGER — mesmo nível de acesso de ApiKey (ver app/api/api-keys):
// esse link expõe número de vendas/ranking/nome de vendedor sem login pra
// quem tiver a URL, não é algo que qualquer papel deveria gerar/revogar
// sozinho.
const ALLOWED_ROLES = ["OWNER", "MANAGER"] as const;

export async function GET() {
  const access = await requireRole([...ALLOWED_ROLES]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    // Só o link ATIVO (não revogado) mais recente — a UI (ver
    // tv-display-link-manager.tsx) trata isso como "o" link da organização,
    // não uma lista; revogados ficam só no histórico do banco.
    const link = await prisma.tvDisplayLink.findFirst({
      where: { organizationId: access.organizationId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { name: true } } },
    });

    if (!link) return NextResponse.json({ link: null });
    return NextResponse.json({
      link: {
        id: link.id,
        tokenPrefix: link.tokenPrefix,
        createdByName: link.createdBy.name,
        lastUsedAt: link.lastUsedAt,
        createdAt: link.createdAt,
      },
    });
  });
}

export async function POST(req: Request) {
  const access = await requireRole([...ALLOWED_ROLES]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const { fullToken, tokenPrefix, tokenHash } = generateTvDisplayLinkToken();

    // Gerar um novo já revoga qualquer outro ainda ativo — só "o" link da
    // organização por vez (evita esquecer um link antigo configurado numa
    // TV velha ainda funcionando depois de "gerar outro"). Duas chamadas
    // sequenciais, não um `$transaction` — o cliente já injeta o
    // set_config/RLS em CADA operação por conta própria (ver
    // withTenantRls em lib/prisma.ts), então não precisa (nem deveria:
    // aninhar $transaction dentro da própria extensão não é um caminho
    // testado aqui) agrupar as duas numa transação manual só pra isso.
    await prisma.tvDisplayLink.updateMany({
      where: { organizationId: access.organizationId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const link = await prisma.tvDisplayLink.create({
      data: {
        organizationId: access.organizationId,
        tokenPrefix,
        tokenHash,
        createdById: access.userId,
      },
    });

    await logAudit({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      actorName: access.session.user.name ?? access.session.user.email ?? "?",
      action: "TV_DISPLAY_LINK_CREATED",
      targetType: "TvDisplayLink",
      targetId: link.id,
      detail: `prefixo "${link.tokenPrefix}…"`,
      ip: getClientIp(req),
    });

    // fullToken só existe nesta resposta — nunca persistido, nunca mais
    // recuperável depois (mesmo padrão de mostrar-uma-vez de /api/api-keys).
    return NextResponse.json(
      { id: link.id, tokenPrefix: link.tokenPrefix, fullToken, createdAt: link.createdAt },
      { status: 201 },
    );
  });
}
