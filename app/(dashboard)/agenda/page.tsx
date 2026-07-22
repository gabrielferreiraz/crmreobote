import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDealScope, scopeWhere } from "@/lib/team-scope";
import { resolveAvatarUrlMap } from "@/lib/r2";
import { runWithTenant } from "@/lib/tenant-context";
import { getValidGoogleAccessToken, fetchGoogleCalendarEvents } from "@/lib/google-calendar-oauth";
import { resolveConnectedInstance } from "@/lib/whatsapp/send";
import { TasksList } from "./tasks-list";
import { TasksListMobile } from "./tasks-list-mobile";
import type { GoogleEvent } from "./task-calendar";

/**
 * -60/+90 dias: cobre bem a navegação real do calendário (a grade não
 * re-busca por mês, é tudo carregado de uma vez e filtrado no cliente — igual
 * já funciona pras tarefas do próprio CRM). Falha do Google (token revogado,
 * API fora do ar) nunca derruba a página inteira: só a Agenda fica sem os
 * eventos do Google até a próxima carga.
 */
async function loadGoogleEvents(userId: string): Promise<{ connected: boolean; events: GoogleEvent[] }> {
  try {
    const connection = await prisma.googleCalendarConnection.findUnique({ where: { userId } });
    if (!connection) return { connected: false, events: [] };

    const accessToken = await getValidGoogleAccessToken(connection);
    const timeMin = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const timeMax = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const events = await fetchGoogleCalendarEvents(accessToken, timeMin, timeMax);
    return {
      connected: true,
      events: events.map((e) => ({ id: e.id, title: e.title, start: e.start.toISOString(), allDay: e.allDay, htmlLink: e.htmlLink })),
    };
  } catch (err) {
    console.error("[google-calendar] falha ao carregar eventos pra Agenda", err);
    // Tinha conexão mas a chamada falhou (token revogado, API fora do ar) —
    // ainda assim está "conectado" pro propósito do banner (não oferece
    // reconectar à toa quando o problema é passageiro do lado do Google).
    const connection = await prisma.googleCalendarConnection.findUnique({ where: { userId }, select: { id: true } });
    return { connected: !!connection, events: [] };
  }
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ novo?: string; google?: string }>;
}) {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const userId = session!.user.id;
  const { novo, google } = await searchParams;

  return runWithTenant(organizationId, async () => {
    const scope = await getDealScope(organizationId, userId, session!.user.role);

    // Tarefa concluída nunca mais some sozinha (fica pra sempre no banco) —
    // sem uma janela, a Agenda de uma organização antiga carregaria anos de
    // "Concluídas" em toda visita. Pendente/atrasada continua sem limite de
    // data (é o trabalho ativo de verdade, sempre precisa aparecer inteiro);
    // só a concluída ganha uma janela recente + o teto duro de segurança.
    const COMPLETED_TASKS_WINDOW_DAYS = 30;
    const TASKS_FETCH_CAP = 2000;
    const completedSince = new Date(Date.now() - COMPLETED_TASKS_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [tasksRaw, membersRaw, deals, googleResult, whatsappInstance] = await Promise.all([
      prisma.task.findMany({
        where: {
          organizationId,
          ...scopeWhere(scope),
          OR: [{ completedAt: null }, { completedAt: { gte: completedSince } }],
        },
        orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
        take: TASKS_FETCH_CAP,
        include: {
          deal: {
            select: { id: true, name: true, value: true, stage: { select: { name: true } } },
          },
          contact: {
            select: { id: true, name: true, phone: true, whatsapp: true, source: true, email: true },
          },
          owner: { select: { id: true, name: true, image: true } },
        },
      }),
      prisma.organizationUser.findMany({
        where: { organizationId, active: true },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, name: true } } },
      }),
      prisma.deal.findMany({
        where: { organizationId, status: "OPEN" },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      loadGoogleEvents(userId),
      resolveConnectedInstance(organizationId, userId),
    ]);
    // Se meu WhatsApp não está conectado, o convite de reunião (ver
    // MeetingInviteDialog) nem oferece a opção de enviar — só o botão de
    // agenda Google continua disponível.
    const isWhatsAppConnected = !!whatsappInstance;

    const avatarMap = await resolveAvatarUrlMap(tasksRaw.map((t) => t.owner.image));
    const tasks = tasksRaw.map((task) => ({
      ...task,
      deal: task.deal
        ? {
            id: task.deal.id,
            name: task.deal.name,
            value: task.deal.value != null ? Number(task.deal.value) : null,
            stageName: task.deal.stage?.name ?? null,
          }
        : null,
      contact: task.contact
        ? {
            id: task.contact.id,
            name: task.contact.name,
            phone: task.contact.phone ?? task.contact.whatsapp ?? null,
            source: task.contact.source ?? null,
            email: task.contact.email ?? null,
          }
        : null,
      owner: {
        id: task.owner.id,
        name: task.owner.name,
        photoUrl: task.owner.image ? (avatarMap.get(task.owner.image) ?? null) : null,
      },
    }));

    const members = (
      scope.type === "owners" ? membersRaw.filter((m) => scope.ownerIds.includes(m.userId)) : membersRaw
    ).map((m) => m.user);

    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Agenda</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Reuniões, ligações e follow-ups do time</p>
        </div>
        <div className="hidden lg:block">
          <TasksList
            initialTasks={tasks}
            deals={deals}
            members={members}
            googleEvents={googleResult.events}
            isGoogleConnected={googleResult.connected}
            isWhatsAppConnected={isWhatsAppConnected}
            googleParam={google}
          />
        </div>
        <div className="lg:hidden">
          <TasksListMobile
            initialTasks={tasks}
            deals={deals}
            members={members}
            openNewTask={novo === "1"}
            isGoogleConnected={googleResult.connected}
            isWhatsAppConnected={isWhatsAppConnected}
            googleParam={google}
          />
        </div>
      </div>
    );
  });
}
