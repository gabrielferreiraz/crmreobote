import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { sanitizeCell } from "@/lib/csv-sanitize";

export const dynamic = "force-dynamic";

/**
 * Só o campo `tags` — decidido à parte do PUT completo em
 * app/api/contacts/[id]/route.ts (que é um replace de TODOS os campos do
 * formulário de edição). Usado pelo "Etiquetar" no chat de WhatsApp, que só
 * conhece o contactId, não o resto do cadastro — chamar o PUT geral de lá
 * apagaria (sobrescreveria com vazio) todos os outros campos do contato.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tags } = (await req.json().catch(() => ({}))) as { tags?: string[] };

  if (!Array.isArray(tags)) return NextResponse.json({ error: "tags é obrigatório" }, { status: 400 });

  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const existing = await prisma.contact.findFirst({ where: { id, organizationId } });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const cleanTags = tags.map((t) => sanitizeCell(t.trim())).filter((t): t is string => !!t);

    const contact = await prisma.contact.update({
      where: { id },
      data: { tags: cleanTags },
      select: { id: true, tags: true },
    });
    return NextResponse.json(contact);
  });
}
