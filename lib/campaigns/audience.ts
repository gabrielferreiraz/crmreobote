/**
 * Segmentação de público das campanhas — cargo (múltiplos, não só um texto
 * exato), tags do contato e cidade. Cada lista é um OR entre si; listas
 * diferentes são AND entre si (ex.: cargo IN (...) E cidade IN (...)).
 * Guardado como snapshot em Campaign.audienceFilter só pra
 * referência/reedição — nunca reconsultado sozinho depois da criação (os
 * destinatários reais já materializados é que valem).
 */

import { prisma } from "@/lib/prisma";
import { searchDb } from "@/lib/search-db";
import { Prisma } from "@/app/generated/prisma/client";
import { contactScopeWhere, type DealScope } from "@/lib/team-scope";

export type AudienceFilter = { jobTitles: string[]; tags: string[]; cities: string[] };
export type AudienceOptions = AudienceFilter;

const AUDIENCE_OPTIONS_TTL_MS = 60_000;
const audienceOptionsCache = new Map<string, { at: number; value: AudienceOptions }>();

/**
 * Lista os valores dos filtros sem transferir todos os contatos ao servidor.
 * searchDb ignora RLS, portanto organizacao e responsaveis sao filtrados aqui.
 */
export async function listAudienceOptions(organizationId: string, scope: DealScope): Promise<AudienceOptions> {
  const ownerIds = scope.type === "owners" ? [...scope.ownerIds].sort() : [];
  const cacheKey = `${organizationId}:${scope.type}:${ownerIds.join(",")}`;
  const cached = audienceOptionsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < AUDIENCE_OPTIONS_TTL_MS) return cached.value;

  const ownerFilter =
    scope.type === "all"
      ? Prisma.empty
      : ownerIds.length > 0
        ? Prisma.sql`AND "responsavelId" IN (${Prisma.join(ownerIds)})`
        : Prisma.sql`AND FALSE`;

  const rows = await searchDb.$queryRaw<{ kind: "jobTitle" | "tag" | "city"; value: string }[]>`
    WITH visible AS MATERIALIZED (
      SELECT NULLIF(BTRIM("jobTitle"), '') AS job_title,
             NULLIF(BTRIM("city"), '') AS city,
             tags
      FROM "Contact"
      WHERE "organizationId" = ${organizationId}
        ${ownerFilter}
    ), options AS (
      SELECT 'jobTitle'::text AS kind, job_title AS value FROM visible WHERE job_title IS NOT NULL
      UNION ALL
      SELECT 'city'::text AS kind, city AS value FROM visible WHERE city IS NOT NULL
      UNION ALL
      SELECT 'tag'::text AS kind, NULLIF(BTRIM(tag), '') AS value
      FROM visible CROSS JOIN LATERAL unnest(tags) AS tag
    )
    SELECT kind, value
    FROM options
    WHERE value IS NOT NULL
    GROUP BY kind, value
    ORDER BY kind, value
  `;

  const value: AudienceOptions = { jobTitles: [], tags: [], cities: [] };
  for (const row of rows) {
    if (row.kind === "jobTitle") value.jobTitles.push(row.value);
    else if (row.kind === "tag") value.tags.push(row.value);
    else value.cities.push(row.value);
  }

  if (audienceOptionsCache.size >= 200) {
    const oldestKey = audienceOptionsCache.keys().next().value as string | undefined;
    if (oldestKey) audienceOptionsCache.delete(oldestKey);
  }
  audienceOptionsCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
}

export function parseAudienceFilter(input: unknown): AudienceFilter {
  const record = (input ?? {}) as Record<string, unknown>;
  return {
    jobTitles: toStringArray(record.jobTitles),
    tags: toStringArray(record.tags),
    cities: toStringArray(record.cities),
  };
}

export function audienceFilterIsEmpty(filter: AudienceFilter): boolean {
  return filter.jobTitles.length === 0 && filter.tags.length === 0 && filter.cities.length === 0;
}

export function buildAudienceWhere(organizationId: string, filter: AudienceFilter, scope?: DealScope): Prisma.ContactWhereInput {
  const and: Prisma.ContactWhereInput[] = [];
  if (filter.jobTitles.length) {
    and.push({ OR: filter.jobTitles.map((jobTitle) => ({ jobTitle: { equals: jobTitle, mode: "insensitive" } })) });
  }
  if (filter.tags.length) {
    and.push({ tags: { hasSome: filter.tags } });
  }
  if (filter.cities.length) {
    and.push({ OR: filter.cities.map((city) => ({ city: { equals: city, mode: "insensitive" } })) });
  }
  const base = { organizationId, ...(scope ? contactScopeWhere(scope) : {}) };
  return and.length ? { ...base, AND: and } : base;
}

export async function countAudience(organizationId: string, filter: AudienceFilter, scope?: DealScope): Promise<number> {
  if (audienceFilterIsEmpty(filter)) return 0;
  return prisma.contact.count({ where: buildAudienceWhere(organizationId, filter, scope) });
}

/** Resumo legível pra exibição (lista/detalhe da campanha) — ex.: "Cargo: Advogado, Médico · Cidade: Campo Grande". */
export function describeAudienceFilter(filter: AudienceFilter): string {
  const parts: string[] = [];
  if (filter.jobTitles.length) parts.push(`Cargo: ${filter.jobTitles.join(", ")}`);
  if (filter.tags.length) parts.push(`Tags: ${filter.tags.join(", ")}`);
  if (filter.cities.length) parts.push(`Cidade: ${filter.cities.join(", ")}`);
  return parts.join(" · ") || "Nenhum critério definido";
}
