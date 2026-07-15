/**
 * Escapa texto antes de interpolar em HTML — usado nos e-mails automáticos
 * (automações, alertas de WhatsApp) onde o valor interpolado vem de campo
 * editável por qualquer usuário (nome de contato/negócio/pessoa), nunca do
 * texto fixo do template em si (esse é sempre autoria de OWNER/ADMIN). Sem
 * isso, alguém podia colocar `<a href="...">` no nome de um contato e virar
 * HTML de verdade dentro de um e-mail "confiável" saído da automação.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Aplica escapeHtml em todo valor de um map de variáveis — usado antes de interpolar num corpo de e-mail HTML. */
export function escapeHtmlValues(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, escapeHtml(v)]));
}
