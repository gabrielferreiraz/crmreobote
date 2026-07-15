import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import type { CustomFieldEntity, CustomFieldType } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

const VALID_ENTITY_TYPES: CustomFieldEntity[] = ["CONTACT", "DEAL"];
const VALID_TYPES: CustomFieldType[] = ["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT"];

export async function GET() {
  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const fields = await prisma.customFieldDefinition.findMany({
      where: { organizationId },
      orderBy: [{ entityType: "asc" }, { order: "asc" }],
    });

    return NextResponse.json(fields);
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { label, entityType, type, options, required } = body as {
    label?: string;
    entityType?: string;
    type?: string;
    options?: string[];
    required?: boolean;
  };

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!label?.trim()) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  if (!entityType || !VALID_ENTITY_TYPES.includes(entityType as CustomFieldEntity)) {
    return NextResponse.json({ error: "Aplica-se a inválido" }, { status: 400 });
  }
  if (!type || !VALID_TYPES.includes(type as CustomFieldType)) {
    return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  }
  const cleanOptions = Array.isArray(options) ? options.map((o) => o.trim()).filter(Boolean) : [];
  if (type === "SELECT" && cleanOptions.length === 0) {
    return NextResponse.json({ error: "Lista de opções precisa de ao menos uma opção" }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    const maxOrder = await prisma.customFieldDefinition.aggregate({
      where: { organizationId: access.organizationId, entityType: entityType as CustomFieldEntity },
      _max: { order: true },
    });

    const field = await prisma.customFieldDefinition.create({
      data: {
        organizationId: access.organizationId,
        entityType: entityType as CustomFieldEntity,
        label: label.trim(),
        type: type as CustomFieldType,
        options: type === "SELECT" ? cleanOptions : [],
        required: !!required,
        order: (maxOrder._max.order ?? -1) + 1,
      },
    });

    return NextResponse.json(field, { status: 201 });
  });
}
