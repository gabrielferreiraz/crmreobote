import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDealScope, scopeWhere } from "@/lib/team-scope";
import { resolveAvatarUrlMap } from "@/lib/r2";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveConnectedInstance } from "@/lib/whatsapp/send";
import { TasksList } from "./tasks-list";
import { TasksListMobile } from "./tasks-list-mobile";

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

    const [tasksRaw, membersRaw, deals, whatsappInstance] = await Promise.all([
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
            // jobTitle/company/city: só pro preview da mensagem de WhatsApp
            // programada renderizar {cargo}/{empresa}/{cidade} de verdade no
            // detalhe da tarefa (ver task-detail-modal.tsx) — o envio real
            // (lib/tasks/scheduled-whatsapp.ts) busca o Contact completo à
            // parte, então isso aqui só afeta o que a pessoa VÊ na prévia.
            select: { id: true, name: true, phone: true, whatsapp: true, source: true, email: true, jobTitle: true, company: true, city: true },
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
      // Eventos do Google Agenda NÃO entram mais aqui — o Google é uma
      // dependência externa (rede, disponibilidade, latência variável fora
      // do nosso controle) e travava a página inteira até responder, mesmo
      // com timeout de 8s (ver lib/google-calendar-oauth.ts). Agora o
      // cliente busca via useGoogleCalendarEvents() (TasksList/
      // TasksListMobile), DEPOIS que a grade principal já está na tela — se
      // o Google demorar ou falhar, só o bloco dele fica esperando/mostra
      // que não conectou, nunca bloqueia tarefa nenhuma do CRM.
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
            jobTitle: task.contact.jobTitle ?? null,
            company: task.contact.company ?? null,
            city: task.contact.city ?? null,
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
            isWhatsAppConnected={isWhatsAppConnected}
            googleParam={google}
          />
        </div>
      </div>
    );
  });
}
