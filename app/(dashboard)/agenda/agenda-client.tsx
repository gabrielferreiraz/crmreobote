"use client";

import { useGoogleCalendarEvents } from "@/lib/use-google-calendar-events";
import { useDesktopViewport } from "@/lib/use-desktop-viewport";
import dynamic from "next/dynamic";
import type { Task } from "./task-row";
import type { Option } from "./tasks-list";

const TasksList = dynamic(() => import("./tasks-list").then((mod) => mod.TasksList));
const TasksListMobile = dynamic(() => import("./tasks-list-mobile").then((mod) => mod.TasksListMobile));

/**
 * TasksList (desktop) e TasksListMobile (celular) ficam os DOIS montados ao
 * mesmo tempo (alternados só por CSS — `hidden lg:block`/`lg:hidden` —
 * nunca desmontados, pra não perder estado nem piscar layout ao
 * redimensionar a janela). Cada um chamava useGoogleCalendarEvents() por
 * conta própria — duas buscas SIMULTÂNEAS em /api/google-calendar/events a
 * cada carregamento da Agenda, dobrando à toa o consumo da cota do Google
 * Calendar API (recurso externo, limitado por projeto Google — importa mais
 * conforme mais clientes usam isso ao mesmo tempo) e o refresh de token
 * OAuth quando o access token está perto de vencer
 * (getValidGoogleAccessToken não tem lock nenhum — duas chamadas
 * concorrentes rodam o refresh em paralelo, cada uma gastando uma chamada a
 * mais no endpoint de token do Google). Este wrapper existe só pra buscar
 * uma vez aqui e repassar pros dois — nenhuma mudança de comportamento
 * visível, só corta a duplicidade.
 */
export function AgendaClient({
  initialTasks,
  deals,
  members,
  isWhatsAppConnected,
  googleParam,
  openNewTask,
  tasksTruncated,
}: {
  initialTasks: Task[];
  deals: Option[];
  members: Option[];
  isWhatsAppConnected: boolean;
  googleParam?: string;
  openNewTask: boolean;
  // true quando a consulta no servidor bateu no teto de segurança
  // (TASKS_FETCH_CAP, ver page.tsx) — existe mais tarefa que não veio.
  tasksTruncated: boolean;
}) {
  const googleCalendar = useGoogleCalendarEvents();
  const desktop = useDesktopViewport();

  if (desktop === null) {
    return <div className="card min-h-72 animate-pulse bg-neutral-100 dark:bg-neutral-900" aria-label="Carregando agenda" />;
  }

  if (desktop) {
    return (
      <TasksList
        initialTasks={initialTasks}
        deals={deals}
        members={members}
        openNewTask={openNewTask}
        isWhatsAppConnected={isWhatsAppConnected}
        googleParam={googleParam}
        googleCalendar={googleCalendar}
        tasksTruncated={tasksTruncated}
      />
    );
  }

  return (
    <TasksListMobile
      initialTasks={initialTasks}
      deals={deals}
      members={members}
      openNewTask={openNewTask}
      isWhatsAppConnected={isWhatsAppConnected}
      googleParam={googleParam}
      googleCalendar={googleCalendar}
      tasksTruncated={tasksTruncated}
    />
  );
}
