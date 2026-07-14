/**
 * Link "quick add" do Google Agenda — abre a tela de criar evento já
 * preenchida, pra pessoa confirmar e salvar na própria conta Google. Não
 * precisa de OAuth nem de nenhuma credencial: é só uma URL com parâmetros,
 * documentada publicamente pelo próprio Google. Isso é o oposto de
 * sincronização de verdade (importar o Google Agenda pra dentro do CRM),
 * que aí sim exigiria criar um app OAuth no Google Cloud Console.
 */
function toGoogleCalendarDate(d: Date): string {
  return `${d.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

export function buildGoogleCalendarUrl(params: {
  title: string;
  description?: string | null;
  start: Date | string;
  durationMinutes?: number;
}): string {
  const start = new Date(params.start);
  const end = new Date(start.getTime() + (params.durationMinutes ?? 30) * 60 * 1000);

  const search = new URLSearchParams({
    action: "TEMPLATE",
    text: params.title,
    dates: `${toGoogleCalendarDate(start)}/${toGoogleCalendarDate(end)}`,
  });
  if (params.description) search.set("details", params.description);

  return `https://calendar.google.com/calendar/render?${search.toString()}`;
}
