import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess, processScopeWhere } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";
import { rankTemplatesForProcess } from "@/lib/processes/templates";

export const dynamic = "force-dynamic";

/**
 * Biblioteca de modelos de solicitação (documentação/petição) — ver "Enviar
 * modelo" em process-detail.tsx. Só administrativo (quem manda os pedidos);
 * consultor só recebe, nunca navega essa lista.
 *
 * `?processId=` (obrigatório) devolve já ORDENADA pro contexto daquele
 * processo — mais usado nesta etapa primeiro, já usado neste processo por
 * último (ver lib/processes/templates.ts).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const processId = searchParams.get("processId");

  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  if (!processId) return NextResponse.json({ error: "Parâmetro 'processId' é obrigatório" }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    const process = await prisma.process.findFirst({
      where: { id: processId, organizationId: access.organizationId, ...processScopeWhere(access) },
      select: { id: true, stageId: true },
    });
    if (!process) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const templates = await rankTemplatesForProcess(access.organizationId, process.id, process.stageId);
    return NextResponse.json(templates);
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { name, message } = (body ?? {}) as { name?: string; message?: string };

  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  if (!name?.trim()) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  if (!message?.trim()) return NextResponse.json({ error: "Mensagem é obrigatória" }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    const template = await prisma.processTemplate.create({
      data: {
        organizationId: access.organizationId,
        name: name.trim(),
        message: message.trim(),
        createdById: access.userId,
      },
    });
    return NextResponse.json(template, { status: 201 });
  });
}
