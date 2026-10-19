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

/**
 * Erro que não é culpa de quem clicou — a trava por organização (ver
 * withCommissionLock) ficou ocupada por outra pessoa, ou o banco demorou e a
 * transação expirou. Em todos esses casos NADA foi gravado (a transação
 * desfaz tudo), então dá pra dizer isso com segurança.
 */
const BUSY_CODES = new Set(["P2024", "P2028", "P2034"]);
function isBusyError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && BUSY_CODES.has(code)) return true;
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" && /lock timeout|transaction already closed|unable to start a transaction|expired transaction/i.test(message);
}

/**
 * Envolve uma rota do módulo: qualquer erro inesperado vira uma resposta
 * `{ error }` em português (a tela mostra exatamente essa frase), em vez do
 * "Erro no servidor" genérico — e fica registrado no log com o caminho.
 */
export function commissionRoute<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      const req = args[0] instanceof Request ? args[0] : null;
      if (isBusyError(err)) {
        console.warn("[commissions] ocupado", req?.method, req?.url, err);
        return NextResponse.json(
          { error: "Outra pessoa está mexendo nas comissões agora. Nada foi alterado — espere alguns segundos e tente de novo." },
          { status: 503, headers: { "Retry-After": "5" } },
        );
      }
      console.error("[commissions] erro inesperado", req?.method, req?.url, err);
      return NextResponse.json(
        { error: "Algo deu errado do nosso lado. Atualize a página para conferir como ficou e tente de novo." },
        { status: 500 },
      );
    }
  };
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
