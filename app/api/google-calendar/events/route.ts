import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { getValidGoogleAccessToken, fetchGoogleCalendarEvents } from "@/lib/google-calendar-oauth";

export const dynamic = "force-dynamic";

// -60/+90 dias: mesma janela que a Agenda sempre usou (ver comentário
// original em app/(dashboard)/agenda/page.tsx) — cobre a navegação real do
// calendário, que é tudo carregado de uma vez e filtrado no cliente.
const WINDOW_PAST_DAYS = 60;
const WINDOW_FUTURE_DAYS = 90;

/**
 * Busca os eventos do Google Agenda do usuário logado — extraído de
 * app/(dashboard)/agenda/page.tsx (era `loadGoogleEvents`, chamada inline
 * dentro do Promise.all da página) pra virar uma chamada separada, feita
 * pelo cliente DEPOIS da página já ter renderizado o resto — assim a
 * lentidão/instabilidade do Google nunca mais atrasa a grade principal da
 * Agenda. O token OAuth (`connection.accessToken`/`refreshToken`, cifrados
 * no banco) nunca sai do servidor — só o resultado já processado (id,
 * título, datas, link) chega ao navegador, nunca a credencial em si.
 */
export async function GET() {
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const connection = await prisma.googleCalendarConnection.findUnique({ where: { userId } });
    if (!connection) return NextResponse.json({ connected: false, events: [] });

    try {
      const accessToken = await getValidGoogleAccessToken(connection);
      const timeMin = new Date(Date.now() - WINDOW_PAST_DAYS * 24 * 60 * 60 * 1000);
      const timeMax = new Date(Date.now() + WINDOW_FUTURE_DAYS * 24 * 60 * 60 * 1000);
      const events = await fetchGoogleCalendarEvents(accessToken, timeMin, timeMax);
      return NextResponse.json({
        connected: true,
        events: events.map((e) => ({
          id: e.id,
          title: e.title,
          start: e.start.toISOString(),
          end: e.end ? e.end.toISOString() : null,
          allDay: e.allDay,
          htmlLink: e.htmlLink,
          description: e.description,
          location: e.location,
        })),
      });
    } catch (err) {
      console.error("[google-calendar] falha ao carregar eventos pra Agenda", err);
      // Tinha conexão mas a chamada falhou (token revogado, API fora do ar) —
      // ainda assim está "conectado" pro propósito do banner (não oferece
      // reconectar à toa quando o problema é passageiro do lado do Google).
      return NextResponse.json({ connected: true, events: [] });
    }
  });
}
