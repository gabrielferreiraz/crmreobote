import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { label, options, required } = body as {
    label?: string;
    options?: string[];
    required?: boolean;
  };

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!label?.trim()) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    const field = await prisma.customFieldDefinition.findFirst({
      where: { id, organizationId: access.organizationId },
    });
    if (!field) return NextResponse.json({ error: "Campo não encontrado" }, { status: 404 });

    const cleanOptions = Array.isArray(options) ? options.map((o) => o.trim()).filter(Boolean) : field.options;
    if (field.type === "SELECT" && cleanOptions.length === 0) {
      return NextResponse.json({ error: "Lista de opções precisa de ao menos uma opção" }, { status: 400 });
    }

    // entityType e type nunca mudam depois de criado — trocar o tipo
    // invalidaria os valores já salvos nos contatos/negócios que usam esse campo.
    const updated = await prisma.customFieldDefinition.update({
      where: { id },
      data: {
        label: label.trim(),
        options: field.type === "SELECT" ? cleanOptions : [],
        required: !!required,
      },
    });

    return NextResponse.json(updated);
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const field = await prisma.customFieldDefinition.findFirst({
      where: { id, organizationId: access.organizationId },
    });
    if (!field) return NextResponse.json({ error: "Campo não encontrado" }, { status: 404 });

    // Não dá pra empurrar "essa chave existe no JSON" pro SQL de forma
    // simples/portável aqui — busca só a coluna e filtra em memória (volume
    // baixo, é uma tabela de contatos/negócios de uma organização só).
    const rows =
      field.entityType === "CONTACT"
        ? await prisma.contact.findMany({
            where: { organizationId: access.organizationId },
            select: { customFieldValues: true },
          })
        : await prisma.deal.findMany({
            where: { organizationId: access.organizationId },
            select: { customFieldValues: true },
          });

    const inUse = rows.some((r) => {
      const values = r.customFieldValues as Record<string, unknown> | null;
      return values && values[id] !== undefined && values[id] !== null;
    });

    if (inUse) {
      return NextResponse.json(
        { error: "Existem registros usando este campo — remova o valor deles antes de excluir o campo" },
        { status: 409 },
      );
    }

    await prisma.customFieldDefinition.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
