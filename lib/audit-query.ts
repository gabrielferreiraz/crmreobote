/**
 * Leitura da trilha de auditoria: filtros, paginação por cursor e exportação.
 * Sempre dentro de runWithTenant e sempre filtrando por organizationId.
 */

import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { brazilDateStringToUTC, brazilEndOfDayUTC } from "@/lib/timezone";
import { parseChanges, type AuditChange } from "@/lib/audit-diff";
import { ACTION_LABELS, categoryPrefixes } from "@/lib/audit-meta";

export type AuditFilters = {
  /** AAAA-MM-DD (dia em Campo Grande), inclusive. */
  from?: string;
  to?: string;
  actorId?: string;
  /** id de AUDIT_CATEGORIES ou "outros". */
  category?: string;
  action?: string;
  q?: string;
  targetType?: string;
  targetId?: string;
};

export type AuditEntry = {
  id: string;
  actorUserId: string | null;
  actorName: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  detail: string | null;
  changes: AuditChange[];
  ip: string | null;
  createdAt: string;
};

/** Lê os filtros da URL (a tela, a API e a exportação usam os mesmos nomes). */
export function filtersFromParams(params: URLSearchParams): AuditFilters {
  const get = (k: string) => params.get(k)?.trim() || undefined;
  return {
    from: get("from"),
    to: get("to"),
    actorId: get("actorId"),
    category: get("category"),
    action: get("action"),
    q: get("q")?.slice(0, 120),
    targetType: get("targetType"),
    targetId: get("targetId"),
  };
}

export const AUDIT_PAGE_SIZE = 100;
export const AUDIT_EXPORT_LIMIT = 20_000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function encodeCursor(createdAt: Date, id: string): string {
  return `${createdAt.toISOString()}|${id}`;
}

function decodeCursor(raw: string | undefined): { at: Date; id: string } | null {
  if (!raw) return null;
  const [iso, id] = raw.split("|");
  const at = new Date(iso ?? "");
  if (!id || Number.isNaN(at.getTime())) return null;
  return { at, id };
}

/** Todos os prefixos conhecidos: "Outros" = nenhuma categoria reconhece a ação. */
function allPrefixes(): string[] {
  const set = new Set<string>();
  for (const id of ["acesso", "equipe", "cadastro", "negocios", "comissoes", "whatsapp", "servopa", "planilhas", "integracoes", "auditoria"]) {
    for (const p of categoryPrefixes(id) ?? []) set.add(p);
  }
  return [...set];
}

export function buildAuditWhere(organizationId: string, filters: AuditFilters, cursor?: string): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [];

  if (filters.from && DATE_RE.test(filters.from)) and.push({ createdAt: { gte: brazilDateStringToUTC(filters.from) } });
  if (filters.to && DATE_RE.test(filters.to)) and.push({ createdAt: { lte: brazilEndOfDayUTC(filters.to) } });
  if (filters.actorId) and.push({ actorUserId: filters.actorId });
  if (filters.action) and.push({ action: filters.action });
  if (filters.targetType) and.push({ targetType: filters.targetType });
  if (filters.targetId) and.push({ targetId: filters.targetId });

  if (filters.category) {
    const prefixes = categoryPrefixes(filters.category);
    if (prefixes) and.push({ OR: prefixes.map((p) => ({ action: { startsWith: p } })) });
    else if (filters.category === "outros") and.push({ NOT: allPrefixes().map((p) => ({ action: { startsWith: p } })) });
  }

  const term = filters.q?.trim();
  if (term) {
    const lower = term.toLowerCase();
    // O rótulo em português não existe no banco: acha as ações cujo rótulo bate com o termo.
    const matchedActions = Object.entries(ACTION_LABELS)
      .filter(([, label]) => label.toLowerCase().includes(lower))
      .map(([action]) => action);
    and.push({
      OR: [
        { actorName: { contains: term, mode: "insensitive" } },
        { detail: { contains: term, mode: "insensitive" } },
        { targetLabel: { contains: term, mode: "insensitive" } },
        { targetId: term },
        { ip: { contains: term } },
        ...(matchedActions.length > 0 ? [{ action: { in: matchedActions } }] : []),
      ],
    });
  }

  const c = decodeCursor(cursor);
  if (c) and.push({ OR: [{ createdAt: { lt: c.at } }, { createdAt: c.at, id: { lt: c.id } }] });

  return { organizationId, ...(and.length > 0 ? { AND: and } : {}) };
}

type Row = {
  id: string;
  actorUserId: string | null;
  actorName: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  detail: string | null;
  changes: unknown;
  ip: string | null;
  createdAt: Date;
};

function toEntry(r: Row): AuditEntry {
  return {
    id: r.id,
    actorUserId: r.actorUserId,
    actorName: r.actorName,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    targetLabel: r.targetLabel,
    detail: r.detail,
    changes: parseChanges(r.changes),
    ip: r.ip,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Uma página (do mais novo ao mais antigo) + o cursor da próxima, se houver. */
export async function queryAudit(
  organizationId: string,
  filters: AuditFilters,
  options: { cursor?: string; limit?: number } = {},
): Promise<{ entries: AuditEntry[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? AUDIT_PAGE_SIZE, 1), 500);
  const rows = await runWithTenant(organizationId, () =>
    prisma.auditLog.findMany({
      where: buildAuditWhere(organizationId, filters, options.cursor),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    }),
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { entries: page.map(toEntry), nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null };
}

/** Quem aparece na trilha (para o filtro "Pessoa"), do mais recente ao mais antigo. */
export async function listAuditActors(organizationId: string): Promise<{ id: string | null; name: string }[]> {
  const groups = await runWithTenant(organizationId, () =>
    prisma.auditLog.groupBy({
      by: ["actorUserId", "actorName"],
      where: { organizationId },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: "desc" } },
      take: 300,
    }),
  );
  const seen = new Set<string>();
  const out: { id: string | null; name: string }[] = [];
  for (const g of groups) {
    const key = g.actorUserId ?? `name:${g.actorName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: g.actorUserId, name: g.actorName });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** Percorre a trilha filtrada em lotes (para a exportação), do mais novo ao mais antigo. */
export async function* iterateAudit(organizationId: string, filters: AuditFilters, maxRows = AUDIT_EXPORT_LIMIT): AsyncGenerator<AuditEntry> {
  let cursor: string | undefined;
  let sent = 0;
  while (sent < maxRows) {
    const { entries, nextCursor } = await queryAudit(organizationId, filters, { cursor, limit: Math.min(1000, maxRows - sent) });
    for (const e of entries) {
      yield e;
      sent += 1;
    }
    if (!nextCursor) return;
    cursor = nextCursor;
  }
}
