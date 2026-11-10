import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/require-role";
import { rateLimitOrResponse, getClientIp } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit-log";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { AUDIT_EXPORT_LIMIT, filtersFromParams, iterateAudit } from "@/lib/audit-query";
import { actionLabel, categoryLabel, categoryOf } from "@/lib/audit-meta";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function cell(value: string | null | undefined): string {
  const safe = sanitizeCell(value ?? "");
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Campo_Grande", dateStyle: "short", timeStyle: "medium" });

/** Baixa a trilha filtrada em CSV (abre direto no Excel). A própria exportação fica registrada. */
export async function GET(req: Request) {
  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const limited = rateLimitOrResponse(`audit-export:${access.userId}`, 10, 10 * 60_000);
  if (limited) return limited;

  const filters = filtersFromParams(new URL(req.url).searchParams);
  const used = Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  await logAudit({
    organizationId: access.organizationId,
    actorUserId: access.userId,
    actorName: access.session?.user?.name ?? "Dono",
    action: "AUDIT_EXPORTED",
    detail: `Exportou a auditoria em CSV${used ? ` (filtros: ${used})` : " (sem filtros)"}.`,
    ip: getClientIp(req),
  });

  const organizationId = access.organizationId;
  async function* csv(): AsyncGenerator<string> {
    yield "﻿" + ["Data e hora", "Pessoa", "Área do sistema", "Ação", "Item", "O que mudou", "Detalhe", "IP", "Código do evento"].join(";") + "\r\n";
    for await (const e of iterateAudit(organizationId, filters, AUDIT_EXPORT_LIMIT)) {
      const changes = e.changes.map((c) => `${c.label}: ${c.from ?? "vazio"} → ${c.to ?? "vazio"}`).join(" | ");
      yield (
        [
          fmtDate(e.createdAt),
          cell(e.actorName),
          cell(categoryLabel(categoryOf(e.action))),
          cell(actionLabel(e.action)),
          cell(e.targetLabel ?? e.targetId),
          cell(changes),
          cell(e.detail),
          cell(e.ip),
          e.id,
        ].join(";") + "\r\n"
      );
    }
  }

  const stream = Readable.from(csv(), { objectMode: false });
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="auditoria-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
