import { PassThrough, Readable } from "node:stream";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { logAudit } from "@/lib/audit-log";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { iterateBackupMessages, listBackupThreads, type BackupThread } from "@/lib/whatsapp/backup";
import {
  MESSAGE_TYPE_LABEL,
  exportMessageText,
  formatDay,
  formatTime,
  safeFileName,
} from "@/lib/whatsapp/backup-format";

export const dynamic = "force-dynamic";
// Histórico grande leva tempo para sair em fluxo.
export const maxDuration = 300;

type Format = "xlsx" | "csv" | "txt";

/** Limite de uma célula do Excel é 32.767 caracteres. */
const CELL_MAX = 32000;
/** Limite de linhas de uma aba do Excel é 1.048.576 (menos o cabeçalho). */
const XLSX_MAX_ROWS = 1_000_000;

function csvCell(value: string): string {
  const safe = sanitizeCell(value);
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function clip(text: string): string {
  return text.length > CELL_MAX ? `${text.slice(0, CELL_MAX)}…` : text;
}

/**
 * Exporta o histórico de WhatsApp de UMA pessoa — todas as conversas, ou só
 * uma (`threadId`). Formatos: `xlsx` (planilha com aba de resumo + mensagens),
 * `csv` (; com BOM, abre direto no Excel brasileiro) e `txt` (no estilo do
 * "Exportar conversa" do WhatsApp). Sai em fluxo, em lotes, e cada exportação
 * fica na auditoria: é conversa privada de outra pessoa saindo do CRM.
 */
export async function GET(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;

  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const limited = rateLimitOrResponse(`whatsapp-backup-export:${access.userId}`, 12, 10 * 60 * 1000);
  if (limited) return limited;

  const url = new URL(req.url);
  const threadId = url.searchParams.get("threadId");
  const formatParam = url.searchParams.get("format");
  const format: Format = formatParam === "csv" || formatParam === "txt" ? formatParam : "xlsx";

  const member = await runWithTenant(access.organizationId, () =>
    prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId: access.organizationId, userId } },
      include: { user: { select: { name: true } } },
    }),
  );
  if (!member) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const allThreads = await listBackupThreads(access.organizationId, userId);
  const threads = threadId ? allThreads.filter((t) => t.id === threadId) : allThreads;
  if (threads.length === 0) return NextResponse.json({ error: "Nenhuma conversa para exportar" }, { status: 404 });

  const ownerName = member.user.name;
  const totalMessages = threads.reduce((sum, t) => sum + t.messageCount, 0);
  const scope = threadId ? `a conversa com ${threads[0].displayName}` : `${threads.length} conversa(s)`;

  await logAudit({
    organizationId: access.organizationId,
    actorUserId: access.userId,
    actorName: access.session?.user?.name ?? "Dono",
    action: "WHATSAPP_BACKUP_EXPORTED",
    targetType: "User",
    targetId: userId,
    detail: `Exportou ${scope} de ${ownerName} (${totalMessages} mensagem(ns)), formato ${format.toUpperCase()}.`,
  });

  const base = threadId
    ? `backup-${safeFileName(ownerName)}-${safeFileName(threads[0].displayName, "conversa")}`
    : `backup-${safeFileName(ownerName)}`;
  const headers = (type: string, ext: string) => ({
    "Content-Type": type,
    "Content-Disposition": `attachment; filename="${base}.${ext}"`,
    "Cache-Control": "no-store",
  });

  const byId = new Map(threads.map((t) => [t.id, t]));
  const ids = threads.map((t) => t.id);

  if (format === "xlsx") {
    const out = new PassThrough();
    writeWorkbook({ organizationId: access.organizationId, ownerName, threads, ids, byId }, out).catch((err) => {
      console.error("[whatsapp-backup] falha ao gerar planilha", err);
      out.destroy(err instanceof Error ? err : new Error(String(err)));
    });
    return new NextResponse(Readable.toWeb(out) as ReadableStream, {
      headers: headers("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"),
    });
  }

  const text = format === "csv" ? csvStream : txtStream;
  const stream = Readable.from(text({ organizationId: access.organizationId, ownerName, threads, ids, byId }), { objectMode: false });
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    headers: headers(format === "csv" ? "text/csv; charset=utf-8" : "text/plain; charset=utf-8", format),
  });
}

type Job = {
  organizationId: string;
  ownerName: string;
  threads: BackupThread[];
  ids: string[];
  byId: Map<string, BackupThread>;
};

async function writeWorkbook(job: Job, output: PassThrough) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useStyles: true });

  // Aba 1: uma linha por conversa — dá para filtrar/ordenar antes de abrir as mensagens.
  const summary = workbook.addWorksheet("Conversas");
  summary.columns = [
    { header: "Contato", key: "name", width: 32 },
    { header: "Telefone", key: "phone", width: 20 },
    { header: "Mensagens", key: "count", width: 12 },
    { header: "Primeira mensagem", key: "first", width: 18 },
    { header: "Última mensagem", key: "last", width: 18 },
    { header: "Situação", key: "state", width: 22 },
  ];
  summary.getRow(1).font = { bold: true };
  summary.views = [{ state: "frozen", ySplit: 1 }];
  for (const t of job.threads) {
    summary
      .addRow({
        name: sanitizeCell(t.displayName),
        phone: sanitizeCell(t.phoneFormatted),
        count: t.messageCount,
        first: formatDay(t.firstMessageAt),
        last: formatDay(t.lastMessageAt),
        state: t.archived ? "Histórico congelado" : "Conversa ativa",
      })
      .commit();
  }
  await summary.commit();

  // Aba 2: todas as mensagens em ordem (conversa por conversa, da mais antiga para a mais nova).
  const sheet = workbook.addWorksheet("Mensagens");
  sheet.columns = [
    { header: "Data", key: "day", width: 12 },
    { header: "Hora", key: "time", width: 8 },
    { header: "Conversa", key: "thread", width: 28 },
    { header: "Telefone", key: "phone", width: 18 },
    { header: "Quem enviou", key: "who", width: 22 },
    { header: "Tipo", key: "type", width: 12 },
    { header: "Mensagem", key: "text", width: 80, style: { alignment: { wrapText: true, vertical: "top" } } },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  let rows = 0;
  for await (const m of iterateBackupMessages(job.organizationId, job.ids)) {
    if (rows >= XLSX_MAX_ROWS) {
      sheet.addRow({ text: "Limite de linhas da planilha atingido. Exporte em CSV ou por conversa para ver o restante." }).commit();
      break;
    }
    const t = job.byId.get(m.threadId)!;
    sheet
      .addRow({
        day: formatDay(m.createdAt),
        time: formatTime(m.createdAt),
        thread: sanitizeCell(t.displayName),
        phone: sanitizeCell(t.phoneFormatted),
        who: sanitizeCell(m.direction === "OUTBOUND" ? job.ownerName : t.displayName),
        type: MESSAGE_TYPE_LABEL[m.type] ?? m.type,
        text: sanitizeCell(clip(exportMessageText(m.type, m.body, m.metadata))),
      })
      .commit();
    rows += 1;
  }
  await sheet.commit();
  await workbook.commit();
}

async function* csvStream(job: Job): AsyncGenerator<string> {
  // BOM + ponto e vírgula: o Excel brasileiro abre com acento e colunas certas.
  yield "﻿" + ["Data", "Hora", "Conversa", "Telefone", "Quem enviou", "Tipo", "Mensagem"].join(";") + "\r\n";
  for await (const m of iterateBackupMessages(job.organizationId, job.ids)) {
    const t = job.byId.get(m.threadId)!;
    yield (
      [
        formatDay(m.createdAt),
        formatTime(m.createdAt),
        csvCell(t.displayName),
        csvCell(t.phoneFormatted),
        csvCell(m.direction === "OUTBOUND" ? job.ownerName : t.displayName),
        MESSAGE_TYPE_LABEL[m.type] ?? m.type,
        csvCell(exportMessageText(m.type, m.body, m.metadata)),
      ].join(";") + "\r\n"
    );
  }
}

/** No estilo do "Exportar conversa" do WhatsApp: `[09/11/2026 14:35] Nome: texto`. */
async function* txtStream(job: Job): AsyncGenerator<string> {
  let current: string | null = null;
  for await (const m of iterateBackupMessages(job.organizationId, job.ids)) {
    const t = job.byId.get(m.threadId)!;
    if (m.threadId !== current) {
      current = m.threadId;
      yield `${current === job.ids[0] ? "" : "\r\n\r\n"}===== ${t.displayName} (${t.phoneFormatted}) — ${t.messageCount} mensagem(ns) =====\r\n\r\n`;
    }
    const who = m.direction === "OUTBOUND" ? job.ownerName : t.displayName;
    // Mensagem de várias linhas: as seguintes entram recuadas, como o WhatsApp faz.
    const text = exportMessageText(m.type, m.body, m.metadata).replace(/\r?\n/g, "\r\n    ");
    yield `[${formatDay(m.createdAt)} ${formatTime(m.createdAt)}] ${who}: ${text}\r\n`;
  }
}
