import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { requireRole } from "@/lib/require-role";
import { getDealScope, scopeWhere } from "@/lib/team-scope";
import { runWithTenant } from "@/lib/tenant-context";
import type { $Enums } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

const VALID_TYPES: $Enums.TaskType[] = [
  "CALL",
  "WHATSAPP",
  "EMAIL",
  "MEETING",
  "VISIT",
  "PROPOSAL",
  "NOTE",
  "OTHER",
];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const queryScope = searchParams.get("scope") ?? "mine";

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(access.organizationId, async () => {
    // scopeWhere já restringe MEMBER/SUPERVISOR/MANAGER ao que o cargo
    // permite — o parâmetro scope=all do cliente só amplia dentro desse
    // limite (nunca além dele); scope=mine sempre estreita mais, mesmo pra
    // quem tem acesso a tudo (OWNER).
    const dealScope = await getDealScope(access.organizationId, access.userId, access.role);
    const tasks = await prisma.task.findMany({
      where: {
        organizationId: access.organizationId,
        ...scopeWhere(dealScope),
        ...(queryScope === "mine" ? { ownerId: access.userId } : {}),
        ...(status === "pending" ? { completedAt: null } : {}),
        ...(status === "done" ? { completedAt: { not: null } } : {}),
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      include: { deal: true, contact: true, owner: true },
    });

    return NextResponse.json(tasks);
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { type, title, description, dueAt, dealId, contactId, ownerId } = body as {
    type?: string;
    title?: string;
    description?: string;
    dueAt?: string;
    dealId?: string;
    contactId?: string;
    ownerId?: string;
  };

  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId)
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  if (!title || !type || !VALID_TYPES.includes(type as $Enums.TaskType)) {
    return NextResponse.json({ error: "title e type são obrigatórios" }, { status: 400 });
  }
  const taskType = type as $Enums.TaskType;

  return runWithTenant(organizationId, async () => {
    if (dealId) {
      const deal = await prisma.deal.findFirst({ where: { id: dealId, organizationId } });
      if (!deal) return NextResponse.json({ error: "Negócio inválido" }, { status: 400 });
    }

    if (contactId) {
      const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId } });
      if (!contact) return NextResponse.json({ error: "Contato inválido" }, { status: 400 });
    }

    const task = await prisma.task.create({
      data: {
        organizationId,
        type: taskType,
        title,
        description,
        dueAt: dueAt ? new Date(dueAt) : undefined,
        dealId,
        contactId,
        ownerId: ownerId ?? userId,
      },
      include: { deal: true, contact: true, owner: true },
    });

    return NextResponse.json(task, { status: 201 });
  });
}
