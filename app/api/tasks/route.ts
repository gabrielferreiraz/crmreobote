import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { requireRole } from "@/lib/require-role";
import { getDealScope, scopeWhere } from "@/lib/team-scope";
import { getCurrentMembership } from "@/lib/current-membership";
import { runWithTenant } from "@/lib/tenant-context";
import { recordUserChange } from "@/lib/user-activity";
import { hasCalendarWriteScope } from "@/lib/google-calendar-oauth";
import { parseBrazilDateTime } from "@/lib/timezone";
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
  const { type, title, description, dueAt, dealId, contactId, ownerId, activityId } = body as {
    type?: string;
    title?: string;
    description?: string;
    dueAt?: string;
    dealId?: string;
    contactId?: string;
    ownerId?: string;
    // Activity MEETING/VISIT já criada por quem chamou (ver deal-detail.tsx,
    // que cria a Activity primeiro e passa o id aqui) — liga a Task a ela
    // pra saber qual atualizar quando a Task concluir. Se não vier e o type
    // for MEETING/VISIT, uma Activity companheira é criada aqui mesmo (ver
    // abaixo) — cobre quem cria a Task sem passar por esse fluxo (Agenda).
    activityId?: string;
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
      // MEMBER só pode vincular tarefa a contato do qual é responsável —
      // sem isso, criar uma tarefa com contactId alheio seria um vetor de
      // enumeração: o MEMBER saberia que o ID existe (404 vs 400).
      const membership = await getCurrentMembership();
      const isMember = membership?.role === "MEMBER";
      const contactOwnerFilter = isMember ? { responsavelId: userId } : {};
      const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId, ...contactOwnerFilter } });
      if (!contact) return NextResponse.json({ error: "Contato inválido" }, { status: 400 });
    }

    if (ownerId) {
      const membership = await prisma.organizationUser.findUnique({
        where: { organizationId_userId: { organizationId, userId: ownerId } },
      });
      if (!membership) return NextResponse.json({ error: "Responsável inválido" }, { status: 400 });
    }

    // Vínculo Task↔Activity pro resultado de Reunião/Visita ser perguntado
    // na conclusão da Task, não na criação (ver ActivityMeetingOutcome no
    // schema). Duas origens possíveis:
    let linkedActivityId: string | undefined;
    if (activityId) {
      // deal-detail.tsx já criou a Activity (com o corpo/nota digitado) e
      // manda o id aqui — só valida que é da mesma organização antes de ligar.
      const activity = await prisma.activity.findFirst({ where: { id: activityId, organizationId } });
      if (!activity) return NextResponse.json({ error: "Activity inválida" }, { status: 400 });
      linkedActivityId = activity.id;
    } else if (taskType === "MEETING" || taskType === "VISIT") {
      // Ninguém criou uma Activity antes (caso da Agenda solta, "Nova
      // atividade" — só manda Task) — cria a companheira aqui mesmo, em
      // PENDING, pra esta Reunião/Visita também aparecer na timeline do
      // negócio e contar nos relatórios assim que tiver um resultado.
      const activity = await prisma.activity.create({
        data: {
          organizationId,
          dealId,
          contactId,
          userId: ownerId ?? userId,
          type: taskType,
          body: title,
          meetingOutcome: "PENDING",
        },
      });
      linkedActivityId = activity.id;
    }

    const task = await prisma.task.create({
      data: {
        organizationId,
        type: taskType,
        title,
        description,
        dueAt: dueAt ? parseBrazilDateTime(dueAt) : undefined,
        dealId,
        contactId,
        ownerId: ownerId ?? userId,
        activityId: linkedActivityId,
      },
      include: { deal: true, contact: true, owner: true },
    });

    recordUserChange(organizationId, userId).catch((err) =>
      console.error("[user-activity] falha ao registrar alteração", err),
    );

    // Só consultada pra Reunião — é o único tipo que usa isso (ver
    // MeetingInviteDialog), poupa a consulta à toa nos outros 7 tipos.
    // Calculado aqui (não num round-trip à parte do cliente) porque
    // MeetingInviteDialog já abre imediatamente após esta resposta.
    let ownerGoogleCalendarWriteConnected = false;
    if (taskType === "MEETING") {
      const connection = await prisma.googleCalendarConnection.findUnique({ where: { userId: task.ownerId } });
      ownerGoogleCalendarWriteConnected = !!connection && hasCalendarWriteScope(connection.scope);
    }

    return NextResponse.json({ ...task, ownerGoogleCalendarWriteConnected }, { status: 201 });
  });
}
