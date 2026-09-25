import { NextResponse } from "next/server";

type Entry = { count: number; resetAt: number };

/**
 * Limitador em memória (fixed window). Não é compartilhado entre instâncias/processos
 * e reseta a cada restart do servidor — suficiente para v1 sem depender de Redis/Upstash.
 * Se o app rodar em múltiplas instâncias atrás de um load balancer, cada instância
 * mantém sua própria contagem (o limite efetivo vira limit × nº de instâncias).
 */
const store = new Map<string, Entry>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();

  // Limpeza oportunista para não deixar o Map crescer sem limite se um atacante
  // rotacionar chaves (e-mails/IPs) diferentes a cada tentativa.
  if (Math.random() < 0.01) {
    for (const [k, v] of store) if (v.resetAt <= now) store.delete(k);
  }

  const entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (entry.count >= limit) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }

  entry.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

export function resetRateLimit(key: string) {
  store.delete(key);
}

/**
 * Só CONSULTA (não conta uma tentativa) — pra limite que deve contar apenas
 * FALHAS: checa com isto antes de tentar e registra com rateLimit() só quando
 * falhar. Usado no login por IP (lib/auth.ts): um escritório inteiro entra no
 * mesmo IP público às 8h, e login BEM-sucedido não pode gastar o orçamento.
 */
export function peekRateLimit(key: string, limit: number): { blocked: boolean; retryAfterMs: number } {
  const entry = store.get(key);
  const now = Date.now();
  if (!entry || entry.resetAt <= now) return { blocked: false, retryAfterMs: 0 };
  return { blocked: entry.count >= limit, retryAfterMs: Math.max(0, entry.resetAt - now) };
}

/**
 * Mesma checagem de rateLimit, mas já devolve a resposta 429 pronta (ou
 * null se liberado) — evita repetir o boilerplate de status/Retry-After em
 * cada rota que precisa disso.
 */
export function rateLimitOrResponse(key: string, limit: number, windowMs: number): NextResponse | null {
  const { allowed, retryAfterMs } = rateLimit(key, limit, windowMs);
  if (allowed) return null;
  return NextResponse.json(
    { error: "Muitas requisições. Tente novamente em alguns instantes." },
    { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
  );
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
