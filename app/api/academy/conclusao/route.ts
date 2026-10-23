import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAcademyToken } from "@/lib/require-academy-token";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { runWithTenant } from "@/lib/tenant-context";
import { logAudit } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

const aulaIdSchema = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/);
const requestSchema = z.object({
  cursoId: z.string().trim().min(1).max(100),
  aulasObrigatorias: z.array(aulaIdSchema).min(1).max(200),
}).strict();

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Confirma a conclusão do curso pelo usuário do access token da Academy.
 * A data original é a conclusão da última aula obrigatória: Progresso já é
 * idempotente e nunca sobrescreve concluidaEm, então não precisamos manter
 * uma segunda fonte de verdade para o mesmo evento.
 */
export async function POST(req: Request) {
  const access = await requireAcademyToken(req);
  if (!access.ok) return json({ error: access.error }, access.status);

  const rateLimited = rateLimitOrResponse(`academy:${access.userId}:course-completion`, 10, 60_000);
  if (rateLimited) {
    rateLimited.headers.set("Cache-Control", "no-store");
    return rateLimited;
  }

  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Requisição inválida" }, 400);

  const { cursoId } = parsed.data;
  const aulasObrigatorias = Array.from(new Set(parsed.data.aulasObrigatorias));

  const result = await runWithTenant(access.organizationId, () =>
    prisma.$transaction(async (tx) => {
      const progresso = await tx.progresso.findMany({
        where: {
          organizationId: access.organizationId,
          userId: access.userId,
          aulaId: { in: aulasObrigatorias },
        },
        select: { aulaId: true, concluidaEm: true },
      });

      if (progresso.length !== aulasObrigatorias.length) {
        return { ok: false as const };
      }

      const concluidoEm = progresso.reduce(
        (latest, lesson) => lesson.concluidaEm > latest ? lesson.concluidaEm : latest,
        progresso[0].concluidaEm,
      );

      const updated = await tx.organizationUser.updateMany({
        where: {
          organizationId: access.organizationId,
          userId: access.userId,
          active: true,
          role: "MEMBER",
          area: "VENDAS",
          academyOnboardingStatus: { in: ["REQUIRED", "STARTED"] },
        },
        data: { academyOnboardingStatus: "CRM_UNLOCKED" },
      });

      const membership = await tx.organizationUser.findUnique({
        where: {
          organizationId_userId: {
            organizationId: access.organizationId,
            userId: access.userId,
          },
        },
        select: { academyOnboardingStatus: true, role: true, area: true },
      });

      return {
        ok: true as const,
        created: updated.count > 0,
        concluidoEm,
        status: membership?.academyOnboardingStatus ?? null,
        restrictedAudience: membership?.role === "MEMBER" && membership.area === "VENDAS",
      };
    }),
  );

  if (!result.ok) return json({ error: "Curso não concluído" }, 409);

  if (result.created) {
    await logAudit({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      actorName: "Reobote Academy",
      action: "ACADEMY_CRM_UNLOCKED",
      targetType: "User",
      targetId: access.userId,
      detail: `${access.name}: concluiu o curso ${cursoId}`,
    });
  }

  return json(
    {
      concluidoEm: result.concluidoEm.toISOString(),
      crmLiberado:
        !result.restrictedAudience || result.status === "CRM_UNLOCKED" || result.status === "NOT_REQUIRED",
    },
    result.created ? 201 : 200,
  );
}
