import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope, scopeWhere } from "@/lib/team-scope";
import { getValidGoogleAccessToken, createGoogleCalendarEvent, hasCalendarWriteScope } from "@/lib/google-calendar-oauth";

export const dynamic = "force-dynamic";

const MEETING_DURATION_MINUTES = 60; // mesma duração assumida pelo link "adicionar à minha agenda" em lib/meeting-invite.ts

/**
 * Cria o evento de verdade no Google Agenda do RESPONSÁVEL da tarefa
 * (task.ownerId, nunca de quem clicou — mesma regra de
 * send-meeting-invite/route.ts), com um link do Google Meet anexado — só
 * funciona se esse consultor tiver GoogleCalendarConnection com escopo de
 * escrita (ver hasCalendarWriteScope); o botão que chama isto no
 * MeetingInviteDialog nem aparece se não tiver, então chegar aqui sem
 * conexão válida não deveria acontecer no fluxo normal — ainda assim
 * checado explicitamente, não confia só na UI.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { session, organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const scope = await getDealScope(organizationId, userId, session!.user.role);
    const task = await prisma.task.findFirst({
      where: { id, organizationId, ...scopeWhere(scope) },
    });
    if (!task) return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 });
    if (task.type !== "MEETING") {
      return NextResponse.json({ error: "Só dá pra criar link do Meet em tarefas do tipo Reunião" }, { status: 400 });
    }
    if (!task.dueAt) return NextResponse.json({ error: "A reunião precisa de data/hora marcada" }, { status: 400 });
    if (task.googleEventId) {
      return NextResponse.json({ error: "Esta reunião já tem um evento criado no Google Agenda" }, { status: 400 });
    }

    const connection = await prisma.googleCalendarConnection.findUnique({ where: { userId: task.ownerId } });
    if (!connection || !hasCalendarWriteScope(connection.scope)) {
      return NextResponse.json({ error: "O responsável não tem o Google Agenda conectado com permissão de escrita" }, { status: 400 });
    }

    try {
      const accessToken = await getValidGoogleAccessToken(connection);
      const start = task.dueAt;
      const end = new Date(start.getTime() + MEETING_DURATION_MINUTES * 60_000);
      const event = await createGoogleCalendarEvent(accessToken, {
        title: task.title,
        description: task.description,
        start,
        end,
        withMeet: true,
      });
      await prisma.task.update({
        where: { id: task.id },
        data: { googleEventId: event.id, googleMeetLink: event.meetLink },
      });
      return NextResponse.json({ googleMeetLink: event.meetLink });
    } catch (err) {
      console.error(`[create-google-meet] falha ao criar evento pra tarefa ${task.id}`, err);
      return NextResponse.json({ error: "Não consegui criar o evento no Google Agenda agora — tente de novo" }, { status: 502 });
    }
  });
}
