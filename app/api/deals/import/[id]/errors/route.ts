import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

type IssueRow = { rowNumber: number; contactName: string | null; dealName: string | null; issues: { code: string; message: string }[] };

/** Célula de CSV — aspas em volta se tiver ; " ou quebra de linha, aspas internas dobradas (RFC 4180). */
function csvCell(value: string): string {
  if (/[;"\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * Planilha das linhas que NÃO viraram negócio (sem contato, duplicidade
 * evitada, etapa/responsável não encontrado, valor ilegível), pra quem
 * importou corrigir e subir só essas de novo — em vez de vasculhar o
 * arquivo original linha por linha comparando com a mensagem de erro.
 * Os valores aqui já saíram sanitizados contra CSV/Formula Injection (ver
 * lib/csv-sanitize.ts, aplicado na LEITURA do arquivo original, antes de
 * qualquer coisa ser gravada) — não precisa sanitizar de novo aqui.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const isManager = ["OWNER", "MANAGER"].includes(access.role ?? "");
    const batch = await prisma.importBatch.findFirst({
      where: {
        id,
        organizationId: access.organizationId,
        ...(isManager ? {} : { createdById: access.userId }),
      },
      select: { fileName: true, issueRows: true },
    });
    if (!batch) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const rows = (batch.issueRows as IssueRow[] | null) ?? [];
    const lines = ["Linha;Contato;Negocio;Motivo"];
    for (const r of rows) {
      const reasons = r.issues.map((i) => i.message).join(" | ");
      lines.push([String(r.rowNumber), r.contactName ?? "", r.dealName ?? "", reasons].map(csvCell).join(";"));
    }
    // BOM no início — sem isso o Excel no Windows abre acento errado (lê
    // como Latin-1 em vez de UTF-8 sem esse aviso explícito no arquivo).
    // String.fromCharCode em vez do caractere literal no código-fonte —
    // invisível de propósito, fácil de virar bagunça de encoding no editor.
    const csv = String.fromCharCode(0xfeff) + lines.join("\r\n");
    const safeFileName = batch.fileName.replace(/[^\w.\- ]/g, "_");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="erros-${safeFileName}.csv"`,
      },
    });
  });
}
