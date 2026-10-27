import { z } from "zod";
import { normalizeGroup, parseCount } from "./parse.ts";
import type { ServopaSnapshotEvidence } from "./snapshot-validation.ts";
import type { NormalizedGroup, ScrapedGroup, ScrapedListRow } from "./types.ts";

const shortText = z.string().max(500);
const cellText = z.string().max(5_000);

const listRowSchema = z.object({
  grupo: z.string().regex(/^\d+$/).max(20),
  segmento: z.enum(["I", "M"]),
  meses: shortText,
  assembleia: shortText,
  lance: shortText,
  contemplados: shortText,
  vagas: shortText,
}).strict();

const scrapedGroupSchema = z.object({
  grupo: z.string().regex(/^\d+$/).max(20),
  segmento: z.enum(["I", "M"]),
  tp: z.literal("S").optional(),
  titulo: z.string().max(1_000),
  preMessage: z.string().max(100_000),
  info: z.record(z.string().max(500), z.string().max(10_000)),
  tabs: z.array(z.object({
    aba: z.string().max(500).nullable(),
    cabecalho: z.array(shortText).max(30),
    linhas: z.array(z.array(cellText).min(1).max(30)).max(200),
  }).strict()).max(50),
}).strict();

const listSchema = z.object({
  segment: z.enum(["REAL_ESTATE", "MOVABLE"]),
  httpStatus: z.number().int().min(100).max(599),
  cloudflareBlocked: z.boolean(),
  rows: z.array(listRowSchema).max(500),
}).strict();

const pageSchema = z.object({
  number: z.string().regex(/^\d+$/).max(20),
  httpStatus: z.number().int().min(100).max(599),
  cloudflareBlocked: z.boolean(),
  group: scrapedGroupSchema.nullable(),
}).strict();

export const servopaSnapshotPayloadSchema = z.object({
  runId: z.string().min(1).max(64),
  leaseToken: z.string().min(32).max(128),
  complete: z.literal(true),
  lists: z.array(listSchema).length(2),
  pages: z.array(pageSchema).min(1).max(500),
}).strict();

export type ServopaSnapshotPayload = z.infer<typeof servopaSnapshotPayloadSchema>;

export class ServopaSnapshotPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServopaSnapshotPayloadError";
  }
}

export function buildServopaSnapshot(payload: ServopaSnapshotPayload): {
  groups: NormalizedGroup[];
  evidence: ServopaSnapshotEvidence;
} {
  const listByGroup = new Map<string, ScrapedListRow>();
  for (const list of payload.lists) {
    const expectedSegment = list.segment === "REAL_ESTATE" ? "I" : "M";
    for (const row of list.rows) {
      if (row.segmento !== expectedSegment) {
        throw new ServopaSnapshotPayloadError(`O grupo ${row.grupo} está na lista de segmento incorreta.`);
      }
      listByGroup.set(row.grupo, row);
    }
  }

  const groups: NormalizedGroup[] = [];
  for (const page of payload.pages) {
    if (!page.group) continue;
    if (page.group.grupo !== page.number) {
      throw new ServopaSnapshotPayloadError(`A página ${page.number} contém dados do grupo ${page.group.grupo}.`);
    }
    groups.push(normalizeGroup(page.group as ScrapedGroup, listByGroup.get(page.number)));
  }

  return {
    groups,
    evidence: {
      lists: payload.lists.map((list) => ({
        segment: list.segment,
        httpStatus: list.httpStatus,
        cloudflareBlocked: list.cloudflareBlocked,
        groups: list.rows.map((row) => ({ number: row.grupo, vacancies: parseCount(row.vagas) })),
      })),
      pages: payload.pages.map((page) => ({
        number: page.number,
        httpStatus: page.httpStatus,
        cloudflareBlocked: page.cloudflareBlocked,
      })),
    },
  };
}
