import { NextResponse } from "next/server";
import { getCommissionAccess } from "@/lib/commissions/access";
import { logAudit, type AuditAction } from "@/lib/audit-log";
import { getClientIp } from "@/lib/rate-limit";

export type ManagerAccess = Extract<Awaited<ReturnType<typeof getCommissionAccess>>, { ok: true }>;

/** Rotas que só o Financeiro (ou o Dono) usa — 401 sem sessão, 403 sem permissão. */
export async function requireCommissionManager(): Promise<{ access: ManagerAccess } | { error: NextResponse }> {
  const access = await getCommissionAccess();
  if (!access.ok) return { error: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  if (!access.canManage) return { error: NextResponse.json({ error: "Só quem cuida das comissões pode fazer isso" }, { status: 403 }) };
  return { access };
}

export function auditCommission(
  req: Request,
  access: ManagerAccess,
  action: AuditAction,
  params: { targetType: string; targetId?: string; detail: string },
) {
  return logAudit({
    organizationId: access.organizationId,
    actorUserId: access.userId,
    actorName: access.actorName,
    action,
    targetType: params.targetType,
    targetId: params.targetId,
    detail: params.detail,
    ip: getClientIp(req),
  });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Valor em reais vindo do formulário (número ou "1234.56") → número com 2 casas, ou null se inválido. */
export function parseMoney(value: unknown): number | null {
  const num = typeof value === "string" ? Number(value.replace(",", ".")) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100) / 100;
}

/** Texto opcional: string aparada, "" vira null, undefined continua undefined ("não mexe"). */
export function optionalText(value: unknown, max = 200): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, max);
  return trimmed ? trimmed : null;
}
