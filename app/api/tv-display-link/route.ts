import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { generateTvDisplayLinkCode } from "@/lib/tv-display-link";
import { logAudit } from "@/lib/audit-log";
import { getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// OWNER/MANAGER — mesmo nível de acesso de ApiKey (ver app/api/api-keys):
// esse link expõe número de vendas/ranking/nome de vendedor sem login pra
// quem tiver a URL, não é algo que qualquer papel deveria gerar/revogar
// sozinho.
const ALLOWED_ROLES = ["OWNER", "MANAGER"] as const;

type LinkKind = "DASHBOARD" | "RANKING";

/**
 * Qual dos dois links (ver TvDisplayLinkKind no schema): a TV principal ou o
 * Ranking do mês. Ausente = DASHBOARD (o comportamento de antes desta rota
 * conhecer o tipo); qualquer OUTRO valor é erro (null aqui), nunca um "cai no
 * padrão" silencioso — gerar um link é destrutivo (revoga o anterior do MESMO
 * tipo), então um typo não pode acabar trocando o link errado.
 */
function parseKind(raw: unknown): LinkKind | null {
  if (raw === undefined || raw === null || raw === "") return "DASHBOARD";
  return raw === "DASHBOARD" || raw === "RANKING" ? raw : null;
}

export async function GET(req: Request) {
  const access = await requireRole([...ALLOWED_ROLES]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const kind = parseKind(new URL(req.url).searchParams.get("kind"));
  if (!kind) return NextResponse.json({ error: "Tipo de link inválido" }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    // Só o link ATIVO (não revogado) mais recente DESTE tipo — a UI (ver
    // tv-display-link-manager.tsx) trata isso como "o" link da organização
    // pra aquele tipo, não uma lista; revogados ficam só no histórico do banco.
    const link = await prisma.tvDisplayLink.findFirst({
      where: { organizationId: access.organizationId, kind, revokedAt: null },
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

  // Corpo opcional `{ kind }` — sem corpo (o que a tela de antes mandava) é a
  // TV principal, igual sempre foi.
  const body = (await req.json().catch(() => null)) as { kind?: unknown } | null;
  const kind = parseKind(body?.kind);
  if (!kind) return NextResponse.json({ error: "Tipo de link inválido" }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    // Cria o novo PRIMEIRO, com tentativas: tokenHash é único no banco inteiro
    // (e links revogados continuam lá, então um código nunca é reaproveitado),
    // e o código do Ranking tem só 3 caracteres — 32.768 possibilidades, então
    // esbarrar num código que já existiu (nesta ou em outra organização) é
    // possível. P2002 = violação de unicidade: sorteia outro e tenta de novo.
    // Criar antes de revogar (e não o contrário) garante que uma falha aqui
    // nunca deixa a organização SEM link depois de já ter revogado o antigo.
    let link: Awaited<ReturnType<typeof prisma.tvDisplayLink.create>> | null = null;
    let displayCode = "";
    for (let attempt = 0; attempt < 10 && !link; attempt++) {
      const generated = generateTvDisplayLinkCode(kind);
      try {
        link = await prisma.tvDisplayLink.create({
          data: {
            organizationId: access.organizationId,
            tokenPrefix: generated.codePrefix,
            tokenHash: generated.codeHash,
            kind,
            createdById: access.userId,
          },
        });
        displayCode = generated.displayCode;
      } catch (err) {
        if ((err as { code?: string }).code !== "P2002") throw err;
      }
    }
    if (!link) {
      return NextResponse.json({ error: "Não foi possível gerar um código único. Tente de novo." }, { status: 503 });
    }

    // Gerar um novo já revoga qualquer outro ainda ativo DO MESMO TIPO — só
    // "o" link da organização por tipo por vez (evita esquecer um link antigo
    // configurado numa TV velha ainda funcionando depois de "gerar outro").
    // Nunca mexe no do outro tipo: trocar o código da TV principal não pode
    // derrubar a TV interna do Ranking, nem o contrário. Duas chamadas
    // sequenciais, não um `$transaction` — o cliente já injeta o
    // set_config/RLS em CADA operação por conta própria (ver
    // withTenantRls em lib/prisma.ts), então não precisa (nem deveria:
    // aninhar $transaction dentro da própria extensão não é um caminho
    // testado aqui) agrupar as duas numa transação manual só pra isso.
    await prisma.tvDisplayLink.updateMany({
      where: { organizationId: access.organizationId, kind, revokedAt: null, id: { not: link.id } },
      data: { revokedAt: new Date() },
    });

    await logAudit({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      actorName: access.session.user.name ?? access.session.user.email ?? "?",
      action: "TV_DISPLAY_LINK_CREATED",
      targetType: "TvDisplayLink",
      targetId: link.id,
      // Ranking: o "prefixo" seria o código inteiro (3 caracteres) — não vai
      // pro log de auditoria.
      detail: kind === "RANKING" ? "Ranking do mês" : `TV principal · prefixo "${link.tokenPrefix}…"`,
      ip: getClientIp(req),
    });

    // DASHBOARD (12 caracteres): displayCode só existe nesta resposta — nunca
    // persistido (só o hash), nunca mais recuperável depois (mesmo padrão de
    // mostrar-uma-vez de /api/api-keys). RANKING (3 caracteres): o código INTEIRO
    // é o tokenPrefix, que fica gravado e visível pra OWNER/MANAGER em
    // Configurações → TV — de propósito, quem precisa redigitar 3 caracteres na
    // TV depois de um reinício não deveria ter que gerar outro.
    return NextResponse.json(
      { id: link.id, kind, tokenPrefix: link.tokenPrefix, displayCode, createdAt: link.createdAt },
      { status: 201 },
    );
  });
}
