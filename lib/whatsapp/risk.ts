/**
 * Critério de "número instável" (risco de banimento) — arquivo folha, sem
 * banco, pra ser usado pelo health-check, pelo motor de campanhas e pelo
 * relatório sem que um importe o outro em círculo.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
// Exportado — o relatório de instabilidade (app/(dashboard)/relatorios/page.tsx)
// usa a MESMA janela/limiar aqui pra "quantas mensagens de campanha essa
// instância mandou na janela de risco" fazer sentido junto do
// recentDisconnectCount, em vez de duplicar o número e arriscar os dois
// desalinharem se esse limiar mudar um dia.
export const RISK_WINDOW_MS = 7 * DAY_MS;
// Queda confirmada 3x numa janela de 7 dias é tratada como sinal de que o
// número está instável/sob suspeita da própria WhatsApp (não só uma
// coincidência de rede) — insistir mandando campanha nesse estado é
// exatamente o padrão que aumenta risco de banimento em vez de reduzir.
export const RISK_THRESHOLD = 3;

/**
 * O número está no estado de risco AGORA: 3+ quedas dentro de uma janela de 7
 * dias ainda vigente. Mesma conta do health-check (que abre/renova a janela a
 * cada queda confirmada) — uma contagem alta com a janela já vencida é
 * histórico, não risco: a próxima queda recomeça do 1.
 */
export function isInstabilityRisk(
  instance: { recentDisconnectCount: number; riskWindowStartedAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (instance.recentDisconnectCount < RISK_THRESHOLD || !instance.riskWindowStartedAt) return false;
  return now.getTime() - instance.riskWindowStartedAt.getTime() < RISK_WINDOW_MS;
}
