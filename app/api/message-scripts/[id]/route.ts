import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { validateSteps } from "@/lib/campaigns/scripts";
import type { Prisma, MessageScript } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

// Restrita (PRIVATE) só é visível/editável por quem criou ou pelo OWNER
// (mesmo acesso administrativo total de Auditoria/Membros) — Pública, por
// todo mundo, como sempre foi. 404 (não 403) pra não confirmar nem que o
// script existe, pra quem não tem acesso.
function canAccessScript(
  script: Pick<MessageScript, "visibility" | "createdById">,
  access: { userId: string; role: "OWNER" | "MANAGER" | "SUPERVISOR" | "MEMBER" },
): boolean {
  return script.visibility === "PUBLIC" || script.createdById === access.userId || access.role === "OWNER";
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const script = await prisma.messageScript.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!script || !canAccessScript(script, access)) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    return NextResponse.json(script);
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, steps, tags, visibility } = body as {
    name?: string;
    steps?: unknown;
    tags?: string[];
    visibility?: string;
  };

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!name?.trim()) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  const validated = validateSteps(steps);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.messageScript.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!existing || !canAccessScript(existing, access)) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const script = await prisma.messageScript.update({
      where: { id },
      data: {
        name: name.trim(),
        steps: validated.steps as unknown as Prisma.InputJsonValue,
        tags: (tags ?? []).map((t) => t.trim()).filter(Boolean),
        ...(visibility === "PUBLIC" || visibility === "PRIVATE" ? { visibility } : {}),
      },
    });
    return NextResponse.json(script);
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.messageScript.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!existing || !canAccessScript(existing, access)) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    await prisma.messageScript.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
