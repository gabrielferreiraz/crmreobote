import { NextResponse } from "next/server";
import { prisma, prismaRaw } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { requireRole } from "@/lib/require-role";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const pipelines = await prisma.pipeline.findMany({
      where: { organizationId },
      orderBy: { order: "asc" },
      include: { stages: { orderBy: { order: "asc" } } },
    });

    return NextResponse.json(pipelines);
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name } = body as { name?: string };

  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!name?.trim()) {
    return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    const last = await prisma.pipeline.findFirst({
      where: { organizationId: access.organizationId },
      orderBy: { order: "desc" },
      select: { order: true },
    });

    // Escrita aninhada (pipeline + etapa) precisa de transação explícita com o
    // cliente sem a extensão de RLS — o Prisma gerencia a atomicidade dessa
    // escrita aninhada com sua própria lógica interna, que não necessariamente
    // roda dentro da mesma mini-transação que a extensão abriria sozinha.
    const pipeline = await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, access.organizationId);
      return tx.pipeline.create({
        data: {
          organizationId: access.organizationId,
          name: name.trim(),
          isDefault: false,
          order: (last?.order ?? 0) + 1,
          stages: {
            create: [{ name: "Nova etapa", order: 1, color: "#6366f1", requiresValue: false }],
          },
        },
        include: { stages: { orderBy: { order: "asc" } } },
      });
    });

    return NextResponse.json(pipeline, { status: 201 });
  });
}
