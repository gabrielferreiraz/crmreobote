/**
 * "Assinatura" da fila de Cadastros: um texto curto que MUDA sempre que algo que a tela
 * mostra muda (venda ganha, cadastro editado, documento enviado/apagado, pedido do
 * administrativo atendido). A tela guarda a assinatura com que foi desenhada e pergunta
 * de tempos em tempos à rota leve /api/cadastros/pulse — quando a assinatura mudou, ela
 * recarrega os dados sozinha. Assim nenhuma venda nova fica escondida atrás de uma tela
 * parada, sem precisar baixar a lista inteira a cada consulta.
 *
 * Chamar sempre dentro de runWithTenant (RLS) — e filtra por organizationId mesmo assim.
 */
import { prisma } from "@/lib/prisma";

export async function getCadastrosSignature(organizationId: string): Promise<string> {
  const [deals, registrations, documents, requests] = await Promise.all([
    prisma.deal.aggregate({ where: { organizationId, status: "WON" }, _count: true, _max: { updatedAt: true } }),
    prisma.dealRegistration.aggregate({ where: { organizationId }, _count: true, _max: { updatedAt: true } }),
    prisma.dealRegistrationDocument.aggregate({ where: { organizationId }, _count: true, _max: { createdAt: true } }),
    prisma.dealDocumentRequest.aggregate({ where: { organizationId }, _count: true, _max: { updatedAt: true } }),
  ]);
  const t = (d: Date | null | undefined) => (d ? d.getTime() : 0);
  return [
    deals._count,
    t(deals._max.updatedAt),
    registrations._count,
    t(registrations._max.updatedAt),
    documents._count,
    t(documents._max.createdAt),
    requests._count,
    t(requests._max.updatedAt),
  ].join("|");
}
