/**
 * A Central de Leads é parte do produto: vem LIGADA, sem depender de nenhuma
 * variável de ambiente para existir. Quem "liga" a dela é cada empresa, ao
 * conectar o número da Central (Atendimentos → engrenagem, só o Dono) — sem
 * número conectado nada muda: não distribui, não bloqueia envio, e a aba só
 * aparece para o Dono (ver lib/whatsapp/central-visibility.ts).
 *
 * `CENTRAL_LEADS_ENABLED=false` continua existindo só como FREIO DE
 * EMERGÊNCIA do servidor inteiro (se o rodízio der problema em produção, dá
 * pra desligar sem novo deploy de código). Qualquer outro valor, ou a variável
 * ausente, deixa a Central ligada.
 */
export function centralLeadsEnabled(): boolean {
  return process.env.CENTRAL_LEADS_ENABLED?.trim().toLowerCase() !== "false";
}
