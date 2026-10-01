import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { requireAcademyToken } from "@/lib/require-academy-token";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

// Mesma validação de aulaId do spec da Academy — id da aula é um slug livre
// dela, este sistema só confere o FORMATO (nunca um catálogo próprio de aulas).
const aulaIdSchema = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/);

/**
 * POST /api/academy/progresso — registra uma aula concluída PELO USUÁRIO DO
 * TOKEN (nunca um userId vindo do corpo — spec explícito da Academy, e
 * consistente com o resto do sistema: o ator nunca é um dado que o cliente
 * manda, ver requireAcademyToken).
 */
export async function POST(req: Request) {
  const access = await requireAcademyToken(req);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const rateLimited = rateLimitOrResponse(`academy:${access.userId}:progresso-post`, 60, 60_000);
  if (rateLimited) return rateLimited;

  const body = await req.json().catch(() => null);
  const parsed = aulaIdSchema.safeParse((body as { aulaId?: unknown } | null)?.aulaId);
  if (!parsed.success) return NextResponse.json({ error: "aulaId inválido" }, { status: 400 });
  const aulaId = parsed.data;

  return runWithTenant(access.organizationId, async () => {
    // Idempotente: se já existe, devolve 200 com a data ORIGINAL (nunca
    // sobrescreve concluidaEm — concluir de novo não deveria "resetar" quando
    // a pessoa terminou a aula da 1ª vez). create (não upsert) + P2002 como
    // corrida esperada: sob concorrência (2 chamadas quase simultâneas — ex.:
    // a Academy reenviando por timeout de rede) a constraint única do banco
    // garante que nunca duplica, e o "perdedor" da corrida simplesmente
    // re-busca e devolve 200, mesmo resultado que teria dado se tivesse
    // chegado 1ms depois (mesmo padrão de POST /api/tv-display-link).
    const existing = await prisma.progresso.findUnique({
      where: { organizationId_userId_aulaId: { organizationId: access.organizationId, userId: access.userId, aulaId } },
      select: { concluidaEm: true },
    });
    if (existing) return NextResponse.json({ aulaId, concluidaEm: existing.concluidaEm.toISOString() }, { status: 200 });

    try {
      const created = await prisma.progresso.create({
        data: { organizationId: access.organizationId, userId: access.userId, aulaId },
        select: { concluidaEm: true },
      });
      return NextResponse.json({ aulaId, concluidaEm: created.concluidaEm.toISOString() }, { status: 201 });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const raced = await prisma.progresso.findUniqueOrThrow({
          where: { organizationId_userId_aulaId: { organizationId: access.organizationId, userId: access.userId, aulaId } },
          select: { concluidaEm: true },
        });
        return NextResponse.json({ aulaId, concluidaEm: raced.concluidaEm.toISOString() }, { status: 200 });
      }
      throw err;
    }
  });
}

/**
 * GET /api/academy/progresso — progresso de TODOS os consultores (só admin).
 * "Consultor" aqui = quem NÃO é admin na Academy (SUPERVISOR/MEMBER — ver
 * mapOrgRoleToAcademyRole em lib/academy-oauth.ts), e só membros ATIVOS da
 * organização (desligado não é útil numa lista de "quem falta terminar o
 * treinamento" — o spec original não excluía inativos, decisão nossa aqui:
 * mesmo padrão que Configurações → Usuários e o dashboard da TV já usam pra
 * "quem conta como time atual").
 */
export async function GET(req: Request) {
  const access = await requireAcademyToken(req);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (access.role !== "admin") return NextResponse.json({ error: "Acesso restrito" }, { status: 403 });

  const rateLimited = rateLimitOrResponse(`academy:${access.userId}:progresso-list`, 30, 60_000);
  if (rateLimited) return rateLimited;

  return runWithTenant(access.organizationId, async () => {
    const consultores = await prisma.organizationUser.findMany({
      where: { organizationId: access.organizationId, active: true, role: { in: ["SUPERVISOR", "MEMBER"] } },
      select: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: "asc" } },
    });

    // Uma consulta só pro progresso de todo mundo (evita N+1 — pedido
    // explícito do spec) e agrupa em memória por userId.
    const progresso = await prisma.progresso.findMany({
      where: { organizationId: access.organizationId, userId: { in: consultores.map((c) => c.user.id) } },
      select: { userId: true, aulaId: true, concluidaEm: true },
    });
    const byUser = new Map<string, { aulaId: string; concluidaEm: Date }[]>();
    for (const p of progresso) {
      const list = byUser.get(p.userId);
      if (list) list.push(p);
      else byUser.set(p.userId, [p]);
    }

    return NextResponse.json(
      consultores.map(({ user }) => {
        const rows = byUser.get(user.id) ?? [];
        const lastActivity = rows.length
          ? rows.reduce((max, r) => (r.concluidaEm > max ? r.concluidaEm : max), rows[0].concluidaEm).toISOString()
          : null;
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          completedLessonIds: rows.map((r) => r.aulaId),
          lastActivity,
        };
      }),
    );
  });
}
