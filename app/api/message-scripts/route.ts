import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { validateSteps, getScriptUsageMap } from "@/lib/campaigns/scripts";
import type { Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET() {
  // Ler a biblioteca (pra usar num envio manual, ver "Enviar script" no chat)
  // é liberado pra qualquer membro ativo — só criar/editar/apagar continua
  // restrito a dono/gerente (ver POST abaixo e app/(dashboard)/whatsapp/scripts/page.tsx).
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const [scripts, usageMap] = await Promise.all([
      prisma.messageScript.findMany({
        where: { organizationId: access.organizationId },
        orderBy: { createdAt: "desc" },
        include: { createdBy: { select: { name: true } } },
      }),
      getScriptUsageMap(access.organizationId),
    ]);

    return NextResponse.json(
      scripts.map((s) => ({ ...s, usage: usageMap.get(s.id) ?? [] })),
    );
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name, steps, tags } = body as { name?: string; steps?: unknown; tags?: string[] };

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!name?.trim()) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  const validated = validateSteps(steps);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    const script = await prisma.messageScript.create({
      data: {
        organizationId: access.organizationId,
        name: name.trim(),
        steps: validated.steps as unknown as Prisma.InputJsonValue,
        tags: (tags ?? []).map((t) => t.trim()).filter(Boolean),
        createdById: access.userId,
      },
    });
    return NextResponse.json({ ...script, usage: [] }, { status: 201 });
  });
}
