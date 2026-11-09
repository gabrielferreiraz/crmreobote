/**
 * Retenção dos documentos pessoais do cadastro do cliente (LGPD): ficam no R2
 * só o tempo de o administrativo baixá-los — DOCUMENT_RETENTION_DAYS depois do
 * Ganho. Rascunho que nunca virou Ganho some depois de
 * DRAFT_DOCUMENT_RETENTION_DAYS. Roda a partir do cron geral (idempotente).
 *
 * Ordem: apaga o arquivo do R2 PRIMEIRO e só então a linha do banco — se o R2
 * falhar a linha continua e a próxima passada tenta de novo (nunca fica um
 * arquivo órfão sem registro). Os dados do cadastro (CPF, endereço…) NÃO são
 * apagados aqui: só os arquivos.
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { deleteRegistrationDoc, isRegistrationDocKey } from "@/lib/r2";
import { logAudit } from "@/lib/audit-log";
import { DOCUMENT_RETENTION_DAYS, DRAFT_DOCUMENT_RETENTION_DAYS } from "./rules";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PER_ORGANIZATION = 200;

export async function purgeExpiredRegistrationDocuments(now = new Date()): Promise<{ deleted: number; failed: number }> {
  const concludedBefore = new Date(now.getTime() - DOCUMENT_RETENTION_DAYS * DAY_MS);
  const draftBefore = new Date(now.getTime() - DRAFT_DOCUMENT_RETENTION_DAYS * DAY_MS);
  const organizations = await prisma.organization.findMany({ select: { id: true } });
  let deleted = 0;
  let failed = 0;

  for (const { id: organizationId } of organizations) {
    const result = await runWithTenant(organizationId, async () => {
      const docs = await prisma.dealRegistrationDocument.findMany({
        where: {
          organizationId,
          OR: [
            // Documento enviado DEPOIS do Ganho (resposta a um pedido do administrativo) ganha o próprio prazo de 7 dias.
            { registration: { completedAt: { lte: concludedBefore } }, createdAt: { lte: concludedBefore } },
            { registration: { completedAt: null }, createdAt: { lte: draftBefore } },
          ],
        },
        select: { id: true, storageKey: true, registrationId: true, registration: { select: { completedAt: true } } },
        take: MAX_PER_ORGANIZATION,
      });
      let ok = 0;
      let bad = 0;
      const concluded = new Set<string>();
      for (const doc of docs) {
        try {
          if (isRegistrationDocKey(doc.storageKey, organizationId)) await deleteRegistrationDoc(doc.storageKey);
          await prisma.dealRegistrationDocument.delete({ where: { id: doc.id } });
          ok++;
          if (doc.registration.completedAt) concluded.add(doc.registrationId);
        } catch (err) {
          bad++;
          console.error("[deal-registration] falha ao apagar documento vencido", doc.id, err);
        }
      }
      // Só marca "documentos entregues" quando não sobrou nenhum arquivo daquele cadastro.
      for (const registrationId of concluded) {
        const left = await prisma.dealRegistrationDocument.count({ where: { registrationId } });
        if (left === 0) {
          await prisma.dealRegistration.update({ where: { id: registrationId }, data: { documentsPurgedAt: now } });
        }
      }
      if (ok > 0) {
        await logAudit({
          organizationId,
          actorName: "Sistema",
          action: "DEAL_REGISTRATION_DOCS_PURGED",
          targetType: "DealRegistration",
          detail: `${ok} documento(s) apagado(s) do servidor após o prazo de retenção`,
        });
      }
      return { ok, bad };
    });
    deleted += result.ok;
    failed += result.bad;
  }
  return { deleted, failed };
}
