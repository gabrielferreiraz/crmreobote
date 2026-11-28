import { NextResponse } from "next/server";
import { prisma, prismaRaw } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { readJsonObjectOrError } from "@/lib/read-body";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJsonObjectOrError(req);
  if (body instanceof NextResponse) return body;
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

    // "Algum registro tem essa chave com valor?" direto no Postgres, parando no
    // primeiro. Antes carregava o JSON de TODOS os clientes/negócios na memória
    // (155 mil clientes hoje) só para responder sim/não. Transação própria com
    // o tenant setado: SQL cru dentro do runWithTenant sozinho bate no RLS e
    // devolve vazio em silêncio.
    const inUse = await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, access.organizationId);
      const hit =
        field.entityType === "CONTACT"
          ? await tx.$queryRaw<unknown[]>`
              SELECT 1 FROM "Contact"
              WHERE "organizationId" = ${access.organizationId}
                AND "customFieldValues" -> ${id}::text IS NOT NULL
                AND "customFieldValues" -> ${id}::text <> 'null'::jsonb
              LIMIT 1`
          : await tx.$queryRaw<unknown[]>`
              SELECT 1 FROM "Deal"
              WHERE "organizationId" = ${access.organizationId}
                AND "customFieldValues" -> ${id}::text IS NOT NULL
                AND "customFieldValues" -> ${id}::text <> 'null'::jsonb
              LIMIT 1`;
      return hit.length > 0;
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
