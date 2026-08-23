import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { getDealScope, scopeWhere } from "@/lib/team-scope";
import { getSharedScope } from "@/lib/share-groups";
import { runWithTenant } from "@/lib/tenant-context";
import { recordUserChange } from "@/lib/user-activity";
import { hasCalendarWriteScope } from "@/lib/google-calendar-oauth";

export const dynamic = "force-dynamic";

const VALID_MEETING_OUTCOMES = ["ATTENDED", "NO_SHOW", "RESCHEDULED"] as const;

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { title, description, dueAt, completed, meetingOutcome } = body as {
    title?: string;
    description?: string;
    dueAt?: string | null;
    completed?: boolean;
    // Resultado de Reunião/Visita — perguntado na CONCLUSÃO da Task (ver
    // components/meeting-outcome-dialog.tsx), não mais na criação. PENDING
    // não é aceito aqui: é um estado só interno (Activity recém-criada,
    // ainda sem resposta), nunca algo que o cliente manda de propósito.
    meetingOutcome?: "ATTENDED" | "NO_SHOW" | "RESCHEDULED";
  };

  if (meetingOutcome !== undefined && !VALID_MEETING_OUTCOMES.includes(meetingOutcome)) {
    return NextResponse.json({ error: "meetingOutcome inválido" }, { status: 400 });
  }
  // Remarcar reabre a tarefa (o encontro não terminou, só mudou de dia) —
  // nunca conclui junto, senão fica um estado contraditório ("concluída"
  // mas remarcada pra outro dia).
  if (meetingOutcome === "RESCHEDULED" && completed === true) {
    return NextResponse.json({ error: "Remarcar não conclui a tarefa — informe a nova data" }, { status: 400 });
  }
  if (meetingOutcome === "RESCHEDULED" && !dueAt) {
    return NextResponse.json({ error: "Informe a nova data/horário da remarcação" }, { status: 400 });
  }

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  // Copiado pra variável própria — dentro de resolveLinkedActivity (função
  // aninhada abaixo) o TS não carrega o estreitamento de `access.ok` feito
  // aqui em cima, então `access.organizationId` lá dentro voltaria a ser
  // `string | null`.
  const { organizationId, userId: accessUserId } = access;

  return runWithTenant(organizationId, async () => {
    // Colaborativo: quem compartilha a agenda OU o negócio ligado a esta
    // tarefa (qualquer um dos dois já basta) pode editar/concluir como
    // coautor — este endpoint é usado tanto pela Agenda quanto pelo
    // detalhe do negócio (ver lib/share-groups.ts).
    const scope = await getSharedScope(organizationId, accessUserId, access.role, ["shareAgenda", "shareDeals"]);
    const existing = await prisma.task.findFirst({
      where: { id, organizationId, ...scopeWhere(scope) },
      include: { activity: true },
    });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const isMeetingOrVisit = existing.type === "MEETING" || existing.type === "VISIT";
    if (meetingOutcome !== undefined && !isMeetingOrVisit) {
      return NextResponse.json({ error: "meetingOutcome só se aplica a Reunião/Visita" }, { status: 400 });
    }

    // Liga (ou cria na hora, pra Task antiga sem uma) a Activity que
    // representa esta Reunião/Visita — atualizada abaixo conforme o caso.
    // Só busca/cria quando de fato precisa mexer no resultado, pra não
    // gastar uma escrita à toa numa edição comum (só título/data).
    async function resolveLinkedActivity() {
      if (existing!.activity) return existing!.activity;
      const created = await prisma.activity.create({
        data: {
          organizationId,
          dealId: existing!.dealId,
          contactId: existing!.contactId,
          userId: accessUserId,
          // resolveLinkedActivity só é chamada quando isMeetingOrVisit já
          // foi confirmado true pelos dois call-sites abaixo — TaskType e
          // ActivityType não são o mesmo tipo pro TS (têm membros extras
          // cada um), daí o cast.
          type: existing!.type as "MEETING" | "VISIT",
          body: existing!.title,
          meetingOutcome: "PENDING",
        },
      });
      await prisma.task.update({ where: { id: existing!.id }, data: { activityId: created.id } });
      return created;
    }

    if (meetingOutcome === "RESCHEDULED") {
      const activity = await resolveLinkedActivity();
      await prisma.activity.update({ where: { id: activity.id }, data: { meetingOutcome: "RESCHEDULED" } });
      const newDue = new Date(dueAt!);
      // Log visível na timeline de que houve trabalho aqui — sem isso, uma
      // tarefa remarcada (que continua aberta, não conclui) fica
      // indistinguível de uma tarefa que ninguém tocou ainda.
      await prisma.activity.create({
        data: {
          organizationId,
          dealId: existing.dealId,
          contactId: existing.contactId,
          userId: accessUserId,
          type: "SYSTEM",
          body: `${existing.type === "MEETING" ? "Reunião" : "Visita"} remarcada para ${newDue.toLocaleDateString("pt-BR")} às ${newDue.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
        },
      });
    } else if (completed === true && isMeetingOrVisit) {
      const activity = await resolveLinkedActivity();
      const currentOutcome = meetingOutcome ?? activity.meetingOutcome;
      // Obrigatório de verdade — não só na UI: fecha a brecha de chamar a
      // API direto sem passar pelo diálogo (components/meeting-outcome-dialog.tsx).
      if (!currentOutcome || currentOutcome === "PENDING") {
        return NextResponse.json({ error: "Informe o resultado da reunião/visita antes de concluir" }, { status: 400 });
      }
      if (meetingOutcome) {
        await prisma.activity.update({ where: { id: activity.id }, data: { meetingOutcome } });
      }
    }

    const task = await prisma.task.update({
      where: { id },
      data: {
        title,
        description,
        dueAt:
          meetingOutcome === "RESCHEDULED"
            ? new Date(dueAt!)
            : dueAt === undefined
              ? undefined
              : dueAt
                ? new Date(dueAt)
                : null,
        completedAt:
          meetingOutcome === "RESCHEDULED" ? null : completed === undefined ? undefined : completed ? new Date() : null,
      },
      include: { deal: true, contact: true, owner: true },
    });

    recordUserChange(organizationId, accessUserId).catch((err) =>
      console.error("[user-activity] falha ao registrar alteração", err),
    );

    // Mesmo campo computado de POST /api/tasks — reaproveitado quando
    // reagendar uma Reunião reabre o MeetingInviteDialog (ver saveTask/
    // deal-detail.tsx), pra oferecer "criar link do Meet" de novo pro
    // horário novo.
    let ownerGoogleCalendarWriteConnected = false;
    if (task.type === "MEETING") {
      const connection = await prisma.googleCalendarConnection.findUnique({ where: { userId: task.ownerId } });
      ownerGoogleCalendarWriteConnected = !!connection && hasCalendarWriteScope(connection.scope);
    }

    return NextResponse.json({ ...task, ownerGoogleCalendarWriteConnected });
  });
}

// Excluir tarefa (qualquer tipo — Reunião/Visita incluídos) é restrito ao
// dono da organização, diferente de PUT acima (editar/concluir, que
// qualquer papel com acesso à tarefa continua podendo fazer). Pedido
// explícito do usuário: exclusão é irreversível e vira evidência de
// reunião/visita perdida se usada por engano — só o Dono decide apagar.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const scope = await getDealScope(access.organizationId, access.userId, access.role);
    const existing = await prisma.task.findFirst({
      where: { id, organizationId: access.organizationId, ...scopeWhere(scope) },
    });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    await prisma.task.delete({ where: { id } });
    recordUserChange(access.organizationId, access.userId).catch((err) =>
      console.error("[user-activity] falha ao registrar alteração", err),
    );
    return NextResponse.json({ ok: true });
  });
}
