"use client";

import { useGoogleCalendarEvents } from "@/lib/use-google-calendar-events";
import { TasksList } from "./tasks-list";
import { TasksListMobile } from "./tasks-list-mobile";
import type { Task } from "./task-row";
import type { Option } from "./tasks-list";

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

  return (
    <>
      <div className="hidden lg:block">
        <TasksList
          initialTasks={initialTasks}
          deals={deals}
          members={members}
          isWhatsAppConnected={isWhatsAppConnected}
          googleParam={googleParam}
          googleCalendar={googleCalendar}
          tasksTruncated={tasksTruncated}
        />
      </div>
      <div className="lg:hidden">
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
      </div>
    </>
  );
}
