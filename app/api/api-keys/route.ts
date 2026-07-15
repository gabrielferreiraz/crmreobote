import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { generateApiKey } from "@/lib/api-keys";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const keys = await prisma.apiKey.findMany({
      where: { organizationId: access.organizationId },
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { name: true } } },
    });
    return NextResponse.json(
      keys.map((k) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        createdByName: k.createdBy.name,
        lastUsedAt: k.lastUsedAt,
        revokedAt: k.revokedAt,
        createdAt: k.createdAt,
      })),
    );
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name } = body as { name?: string };

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!name?.trim()) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    const { fullKey, keyPrefix, keyHash } = generateApiKey();

    const apiKey = await prisma.apiKey.create({
      data: {
        organizationId: access.organizationId,
        name: name.trim(),
        keyPrefix,
        keyHash,
        createdById: access.userId,
      },
    });

    // fullKey só existe nesta resposta — não é persistida em lugar nenhum,
    // nunca mais recuperável depois (mesmo padrão de tempPassword em org/members).
    return NextResponse.json(
      { id: apiKey.id, name: apiKey.name, keyPrefix: apiKey.keyPrefix, fullKey, createdAt: apiKey.createdAt },
      { status: 201 },
    );
  });
}
