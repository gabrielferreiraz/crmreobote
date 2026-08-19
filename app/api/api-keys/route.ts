import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { generateApiKey } from "@/lib/api-keys";
import { logAudit } from "@/lib/audit-log";
import { getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// null = sem expiração (aceito, mas exige escolha explícita na UI — ver
// api-keys-manager.tsx — pra não virar o padrão silencioso de todo mundo).
const EXPIRY_DAYS_OPTIONS = [30, 90, null] as const;

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
        expiresAt: k.expiresAt,
        createdAt: k.createdAt,
      })),
    );
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name, expiresInDays } = body as { name?: string; expiresInDays?: number | null };

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!name?.trim()) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  if (expiresInDays !== undefined && !EXPIRY_DAYS_OPTIONS.includes(expiresInDays as (typeof EXPIRY_DAYS_OPTIONS)[number])) {
    return NextResponse.json({ error: "Prazo de expiração inválido" }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    const { fullKey, keyPrefix, keyHash } = generateApiKey();
    const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;

    const apiKey = await prisma.apiKey.create({
      data: {
        organizationId: access.organizationId,
        name: name.trim(),
        keyPrefix,
        keyHash,
        createdById: access.userId,
        expiresAt,
      },
    });

    await logAudit({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      actorName: access.session.user.name ?? access.session.user.email ?? "?",
      action: "API_KEY_CREATED",
      targetType: "ApiKey",
      targetId: apiKey.id,
      detail: `"${apiKey.name}"${expiresAt ? ` · expira em ${expiresAt.toLocaleDateString("pt-BR")}` : " · sem expiração"}`,
      ip: getClientIp(req),
    });

    // fullKey só existe nesta resposta — não é persistida em lugar nenhum,
    // nunca mais recuperável depois (mesmo padrão de mostrar-uma-vez do
    // TempPasswordDialog, ver components/temp-password-dialog.tsx).
    return NextResponse.json(
      { id: apiKey.id, name: apiKey.name, keyPrefix: apiKey.keyPrefix, fullKey, expiresAt: apiKey.expiresAt, createdAt: apiKey.createdAt },
      { status: 201 },
    );
  });
}
