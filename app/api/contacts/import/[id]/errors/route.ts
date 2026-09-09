import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

type IssueRow = { rowNumber: number; name: string | null; jobTitle: string | null; issues: { code: string; message: string }[] };

/** Célula de CSV — aspas em volta se tiver ; " ou quebra de linha, aspas internas dobradas (RFC 4180). */
function csvCell(value: string): string {
  if (/[;"\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * Planilha das linhas que NÃO viraram contato (sem nome, sem cargo,
 * duplicidade evitada), pra quem importou corrigir e subir só essas de novo
 * — mesmo espírito de app/api/deals/import/[id]/errors/route.ts. Os valores
 * aqui já saíram sanitizados contra CSV/Formula Injection na LEITURA do
 * arquivo original, antes de qualquer coisa ser gravada — não precisa
 * sanitizar de novo aqui.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const batch = await prisma.importBatch.findFirst({
      where: { id, organizationId: access.organizationId, createdById: access.userId },
      select: { fileName: true, issueRows: true },
    });
    if (!batch) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const rows = (batch.issueRows as IssueRow[] | null) ?? [];
    const lines = ["Linha;Nome;Cargo;Motivo"];
    for (const r of rows) {
      const reasons = r.issues.map((i) => i.message).join(" | ");
      lines.push([String(r.rowNumber), r.name ?? "", r.jobTitle ?? "", reasons].map(csvCell).join(";"));
    }
    // BOM no início — sem isso o Excel no Windows abre acento errado.
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
