/**
 * Segmentação de público das campanhas — cargo (múltiplos, não só um texto
 * exato), tags do contato e cidade. Cada lista é um OR entre si; listas
 * diferentes são AND entre si (ex.: cargo IN (...) E cidade IN (...)).
 * Guardado como snapshot em Campaign.audienceFilter só pra
 * referência/reedição — nunca reconsultado sozinho depois da criação (os
 * destinatários reais já materializados é que valem).
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { contactScopeWhere, type DealScope } from "@/lib/team-scope";

export type AudienceFilter = { jobTitles: string[]; tags: string[]; cities: string[] };

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
