import { NextResponse } from "next/server";
import { z } from "zod";
import { prismaRaw } from "@/lib/prisma";
import { getServopaTablesAccess } from "@/lib/servopa-tables/access";
import { toUnits, fromUnits } from "@/lib/servopa-tables/adjust";
import { setTenantOnTx } from "@/lib/tenant-context";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

const MAX_TABLES = 500;
class TablesChangedError extends Error {}

const bodySchema = z.object({
  tableIds: z.array(z.string().min(1).max(100)).min(1).max(MAX_TABLES),
  operation: z.enum(["DISCOUNT", "INCREASE", "RESET"]),
  points: z.string().regex(/^\d{1,3}(?:\.\d{1,4})?$/).optional(),
}).strict();

export async function POST(request: Request) {
  const access = await getServopaTablesAccess();
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!access.canAdjust) return NextResponse.json({ error: "Você não tem permissão para ajustar as tabelas." }, { status: 403 });

  const limited = rateLimitOrResponse(`servopa-adjust:${access.organizationId}:${access.userId}`, 20, 60_000);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ajuste inválido." }, { status: 400 });

  const tableIds = Array.from(new Set(parsed.data.tableIds));
  const reset = parsed.data.operation === "RESET";
  if (!reset && !parsed.data.points) return NextResponse.json({ error: "Informe o ajuste em pontos percentuais." }, { status: 400 });

  let pointsUnits = 0;
  if (!reset) {
    try {
      pointsUnits = toUnits(parsed.data.points!, 4);
    } catch {
      return NextResponse.json({ error: "Informe um ajuste válido." }, { status: 400 });
    }
    if (pointsUnits <= 0 || pointsUnits > 1_000_000) {
      return NextResponse.json({ error: "O ajuste deve ser maior que zero e de no máximo 100 pontos percentuais." }, { status: 400 });
    }
  }
  const signedUnits = parsed.data.operation === "DISCOUNT" ? -pointsUnits : pointsUnits;
  const adjustmentPoints = fromUnits(signedUnits, 4);

  let result;
  try {
    result = await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, access.organizationId);
      const tables = await tx.servopaTable.findMany({
        where: {
          id: { in: tableIds },
          organizationId: access.organizationId,
          active: true,
          group: { active: true, OR: [{ vacancies: null }, { vacancies: { gt: 0 } }] },
          rows: { some: {} },
        },
        select: {
          id: true,
          admRatePercent: true,
          adjustmentPoints: true,
          group: { select: { number: true, reserveFundPercent: true } },
        },
      });
      if (tables.length !== tableIds.length) return { error: "Uma ou mais tabelas não estão disponíveis.", status: 409 } as const;

      if (!reset && tables.some((table) => table.group.reserveFundPercent === null)) {
        return { error: "Uma ou mais tabelas não possuem fundo de reserva informado e não podem ser recalculadas.", status: 422 } as const;
      }
      if (signedUnits < 0 && tables.some((table) => toUnits(table.admRatePercent.toFixed(4), 4) + signedUnits < 0)) {
        return { error: "O desconto deixaria a taxa de uma ou mais tabelas negativa.", status: 422 } as const;
      }

      const now = new Date();
      const previousAdjustments = new Map<string, number>();
      for (const table of tables) {
        const previous = table.adjustmentPoints.toFixed(4);
        previousAdjustments.set(previous, (previousAdjustments.get(previous) ?? 0) + 1);
      }
      const updated = await tx.servopaTable.updateMany({
        where: {
          id: { in: tableIds },
          organizationId: access.organizationId,
          active: true,
          group: { active: true, OR: [{ vacancies: null }, { vacancies: { gt: 0 } }] },
          rows: { some: {} },
        },
        data: { adjustmentPoints, adjustedById: access.userId, adjustedAt: now },
      });
      if (updated.count !== tables.length) throw new TablesChangedError();
      return {
        count: tables.length,
        adjustmentPoints,
        groups: [...new Set(tables.map((table) => table.group.number))].sort((a, b) => Number(a) - Number(b)),
        previousAdjustments: [...previousAdjustments.entries()].sort(([a], [b]) => Number(a) - Number(b)),
        adjustedAt: now,
      } as const;
    }, { maxWait: 10_000, timeout: 15_000 });
  } catch (error) {
    if (error instanceof TablesChangedError) {
      return NextResponse.json({ error: "As tabelas mudaram durante o ajuste. Atualize a página e tente novamente." }, { status: 409 });
    }
    throw error;
  }

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

  const pointsLabel = (pointsUnits / 10_000).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
  const operationLabel = reset ? "Restaurou a taxa original" : `${parsed.data.operation === "DISCOUNT" ? "Desconto" : "Acréscimo"} de ${pointsLabel} p.p.`;
  const groupLabel = result.groups.length <= 12 ? result.groups.join(", ") : `${result.groups.slice(0, 12).join(", ")} e mais ${result.groups.length - 12}`;
  const previousLabel = result.previousAdjustments
    .map(([value, count]) => `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 4 })} p.p. (${count})`)
    .join(", ");
  await logAudit({
    organizationId: access.organizationId,
    actorUserId: access.userId,
    actorName: access.actorName,
    action: "SERVOPA_TABLE_ADJUSTMENT",
    targetType: "ServopaTable",
    targetId: result.count === 1 ? tableIds[0] : undefined,
    detail: `${operationLabel} em ${result.count} tabela(s). Grupos: ${groupLabel}. Ajustes anteriores: ${previousLabel}.`,
  });

  return NextResponse.json({
    updated: result.count,
    adjustmentPoints: result.adjustmentPoints,
    adjustedAt: result.adjustedAt.toISOString(),
  });
}
