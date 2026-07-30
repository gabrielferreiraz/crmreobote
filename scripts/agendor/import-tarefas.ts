/**
 * Importa Tarefas do Agendor (pendentes e finalizadas, mesma função pras
 * duas — chamada 2x pelo orquestrador) → Task. Opção B confirmada: tarefa
 * com mais de um responsável vira uma linha POR responsável (ninguém que
 * estava atribuído some da própria lista de tarefas). Create-only por
 * (agendorTaskId, ownerId).
 */

import { prisma } from "@/lib/prisma";
import { $Enums } from "@/app/generated/prisma/client";
import { ORGANIZATION_ID, resolveUserId } from "@/scripts/agendor/users";
import { resolveCanonicalPersonId, type CanonicalMap } from "@/scripts/agendor/phone-dedup";
import { loadSheet, getHeaders, colIndex, cellText, cellDate } from "@/scripts/agendor/xlsx-utils";
import { runConcurrent } from "@/scripts/agendor/concurrency";

const CONCURRENCY = 16;

const TYPE_MAP: Record<string, $Enums.TaskType> = {
  Ligação: "CALL",
  Email: "EMAIL",
  WhatsApp: "WHATSAPP",
  Visita: "VISIT",
  Reunião: "MEETING",
  Proposta: "PROPOSAL",
  Nota: "NOTE",
  Tarefa: "OTHER",
};

const TITLE_MAX_LEN = 60;

export type TarefasImportResult = {
  created: number;
  skippedAlreadyImported: number;
  skippedNoOwner: number;
  assigneeRowsExpanded: number; // quantas linhas viraram >1 Task por múltiplo responsável
};

export async function importTarefas(
  tarefasPath: string,
  canonicalMap: CanonicalMap,
  dryRun: boolean,
): Promise<TarefasImportResult> {
  const sheet = await loadSheet(tarefasPath);
  const headers = getHeaders(sheet);

  const idxCodigoTarefa = colIndex(headers, "Código da tarefa");
  const idxCodigoNegocio = colIndex(headers, "Código do Negócio");
  const idxCodigoPessoa = colIndex(headers, "Código da Pessoa");
  const idxResponsaveis = colIndex(headers, "Usuários responsáveis");
  const idxTipo = colIndex(headers, "Tipo de tarefa");
  const idxDescricao = colIndex(headers, "Descrição");
  const idxDataAgendamento = colIndex(headers, "Data de agendamento");
  const idxDataFinalizacao = colIndex(headers, "Data de finalização");

  const result: TarefasImportResult = { created: 0, skippedAlreadyImported: 0, skippedNoOwner: 0, assigneeRowsExpanded: 0 };

  // Pré-carga em bloco: deals (id + contactId por agendorDealId), contatos
  // (id por agendorContactId) e tarefas já importadas ((agendorTaskId,
  // ownerId) já existentes) — 3 consultas no total em vez de até 3 por
  // linha (e essa fase tem ~101 mil linhas, expandidas por responsável).
  const [deals, contacts, existingTasks] = await Promise.all([
    prisma.deal.findMany({ where: { agendorDealId: { not: null } }, select: { id: true, agendorDealId: true, contactId: true } }),
    prisma.contact.findMany({ where: { agendorContactId: { not: null } }, select: { id: true, agendorContactId: true } }),
    prisma.task.findMany({ where: { agendorTaskId: { not: null } }, select: { agendorTaskId: true, ownerId: true } }),
  ]);
  const dealByAgendorId = new Map(deals.map((d) => [d.agendorDealId as string, { id: d.id, contactId: d.contactId }]));
  const contactByAgendorId = new Map(contacts.map((c) => [c.agendorContactId as string, c.id]));
  const existingTaskKeys = new Set(existingTasks.map((t) => `${t.agendorTaskId}::${t.ownerId}`));

  const rows: number[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) rows.push(r);

  await runConcurrent(rows, CONCURRENCY, async (r) => {
    const row = sheet.getRow(r);
    const codigoTarefa = cellText(row, idxCodigoTarefa);
    if (!codigoTarefa) return;

    const responsaveisRaw = cellText(row, idxResponsaveis);
    const assignees = (responsaveisRaw ?? "")
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (assignees.length === 0) {
      result.skippedNoOwner++;
      return;
    }
    if (assignees.length > 1) result.assigneeRowsExpanded++;

    const codigoNegocio = cellText(row, idxCodigoNegocio);
    const codigoPessoa = cellText(row, idxCodigoPessoa);
    const tipo = cellText(row, idxTipo) ?? "";
    const type = TYPE_MAP[tipo] ?? "OTHER";
    const descricao = cellText(row, idxDescricao);
    const dueAt = cellDate(row, idxDataAgendamento) ?? undefined;
    const completedAt = cellDate(row, idxDataFinalizacao) ?? undefined;
    const title = (descricao ?? (tipo || "Tarefa")).slice(0, TITLE_MAX_LEN);

    // Resolvido uma vez por linha (não por responsável) — mesmo negócio/
    // contato pra todas as cópias expandidas.
    let dealId: string | null = null;
    let dealContactId: string | null = null;
    if (codigoNegocio) {
      const deal = dealByAgendorId.get(codigoNegocio);
      dealId = deal?.id ?? null;
      dealContactId = deal?.contactId ?? null;
    }
    let contactId: string | null = null;
    if (codigoPessoa) {
      const canonical = resolveCanonicalPersonId(canonicalMap, codigoPessoa);
      contactId = contactByAgendorId.get(canonical) ?? null;
    }
    if (!contactId) contactId = dealContactId;

    for (const assigneeName of assignees) {
      const ownerId = await resolveUserId(assigneeName, dryRun);
      if (!ownerId) {
        result.skippedNoOwner++;
        continue;
      }

      if (existingTaskKeys.has(`${codigoTarefa}::${ownerId}`)) {
        result.skippedAlreadyImported++;
        continue;
      }

      if (dryRun) {
        result.created++;
        continue;
      }

      try {
        await prisma.task.create({
          data: {
            organizationId: ORGANIZATION_ID,
            dealId,
            contactId,
            ownerId,
            type,
            title,
            description: descricao,
            dueAt,
            completedAt,
            agendorTaskId: codigoTarefa,
          },
        });
        result.created++;
      } catch (err) {
        console.error(`[tarefas] falha ao criar tarefa (Código da tarefa ${codigoTarefa}, responsável ${assigneeName}):`, err instanceof Error ? err.message : err);
      }
    }
  });

  return result;
}
