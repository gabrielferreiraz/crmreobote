/**
 * Importa Tarefas do Agendor (pendentes e finalizadas, mesma função pras
 * duas — chamada 2x pelo orquestrador) → Task. Opção B confirmada: tarefa
 * com mais de um responsável vira uma linha POR responsável (ninguém que
 * estava atribuído some da própria lista de tarefas).
 *
 * Por (agendorTaskId, ownerId): cria se não existe, ou SINCRONIZA (só
 * data/hora e título/descrição) se já existe e a planilha nova tem "Data de
 * atualização" mais recente que Task.updatedAt — mesmo modelo de
 * import-negocios.ts (ver syncExistingTask abaixo). Motivo real: consultor
 * arrasta uma ligação pra outro dia direto no calendário do Agendor (não
 * cria tarefa nova, só reagenda a mesma) — sem sincronizar isso, a Agenda
 * daqui ficava presa na data antiga pra sempre (achado real: 3 ligações do
 * Eduardo Fujiyama presas em 01/09 depois dele arrastar pra 02/09).
 */

import { prisma } from "@/lib/prisma";
import { $Enums, Prisma } from "@/app/generated/prisma/client";
import { ORGANIZATION_ID, resolveUserId } from "@/scripts/agendor/users";
import { resolveCanonicalPersonId, type CanonicalMap } from "@/scripts/agendor/phone-dedup";
import { loadSheet, getHeaders, colIndex, cellText, cellDate } from "@/scripts/agendor/xlsx-utils";
import { runConcurrent } from "@/scripts/agendor/concurrency";
import { findAllPaged } from "@/scripts/agendor/pagination";

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
  skippedNoOwner: number;
  assigneeRowsExpanded: number; // quantas linhas viraram >1 Task por múltiplo responsável
  // Tarefa já existente (mesmo agendorTaskId+ownerId) sempre cai numa
  // dessas quatro — ver syncExistingTask. Não existe mais "pulado, já
  // importado" simples.
  updated: number; // dueAt e/ou título/descrição mudaram de verdade
  skippedNoChange: number; // linha mais nova, mas nada de fato diferente
  skippedOlderData: number; // "Data de atualização" não é mais nova que Task.updatedAt
  skippedCompleted: number; // tarefa já concluída AQUI — nunca reabre/reagenda algo já resolvido
};

type ExistingTaskSnapshot = {
  id: string;
  title: string;
  description: string | null;
  dueAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
};

type RowTaskFields = {
  title: string;
  description: string | null;
  dueAt: Date | undefined;
  rowUpdatedAt: Date | null;
};

/**
 * Mesmo espírito de syncExistingDeal (import-negocios.ts): só mexe se a
 * "Data de atualização" da linha for mais nova que o Task.updatedAt já
 * gravado (nunca reverte uma edição feita AO VIVO aqui com um dado
 * desatualizado do Agendor). Só sincroniza data/hora + título/descrição —
 * NUNCA completedAt/resultado: uma tarefa já concluída aqui fica intocada
 * (reagendar/reabrir algo já resolvido a partir de uma planilha não faz
 * sentido, diferente de reabrir um negócio Ganho/Perdido que é uma
 * transição de negócio real).
 */
async function syncExistingTask(
  existing: ExistingTaskSnapshot,
  codigoTarefa: string,
  fields: RowTaskFields,
  dryRun: boolean,
): Promise<"updated" | "skippedNoChange" | "skippedOlderData" | "skippedCompleted"> {
  if (existing.completedAt) return "skippedCompleted";
  if (!fields.rowUpdatedAt || fields.rowUpdatedAt <= existing.updatedAt) return "skippedOlderData";

  const data: Prisma.TaskUncheckedUpdateInput = {};
  const changeParts: string[] = [];

  if (fields.dueAt && (!existing.dueAt || fields.dueAt.getTime() !== existing.dueAt.getTime())) {
    data.dueAt = fields.dueAt;
    changeParts.push(`data/hora → ${fields.dueAt.toLocaleString("pt-BR", { timeZone: "America/Campo_Grande" })}`);
  }
  if (fields.title && fields.title !== existing.title) {
    data.title = fields.title;
    changeParts.push(`título atualizado`);
  }
  if (fields.description !== existing.description) {
    data.description = fields.description;
    // Não entra em changeParts — mudança de descrição sozinha não é um
    // marco que vale logar, mesmo critério do "não loga descrição" em
    // syncExistingDeal.
  }

  if (changeParts.length === 0 && Object.keys(data).length === 0) return "skippedNoChange";

  if (dryRun) {
    if (changeParts.length > 0) {
      console.log(`[tarefas] (dry-run) sincronizaria (Código da tarefa ${codigoTarefa}): ${changeParts.join("; ")}`);
    }
    return "updated";
  }

  data.updatedAt = fields.rowUpdatedAt;
  try {
    await prisma.task.update({ where: { id: existing.id }, data });
  } catch (err) {
    // Ex.: a nova data/hora colide com o índice único anti-duplo-agendamento
    // (mesmo owner+dueAt já ocupado por OUTRA reunião) — mesmo tratamento
    // resiliente do caminho de criação (loga e segue, não derruba a fase
    // inteira por causa de 1 linha).
    console.error(`[tarefas] falha ao sincronizar tarefa (Código da tarefa ${codigoTarefa}):`, err instanceof Error ? err.message : err);
    return "skippedNoChange";
  }
  if (changeParts.length > 0) {
    console.log(`[tarefas] sincronizado (Código da tarefa ${codigoTarefa}): ${changeParts.join("; ")}`);
  }
  return "updated";
}

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
  // Data/hora real de quando a tarefa foi cadastrada no Agendor — usada como
  // createdAt (ver abaixo), pra "Criado em" mostrar o momento verdadeiro em
  // vez da data/hora de quando ESTA importação rodou (mesma ideia já usada
  // em import-pessoas.ts/import-negocios.ts pro "Cadastro" de Pessoa/Negócio).
  const idxDataCadastro = colIndex(headers, "Data de cadastro");
  // Guarda de sincronização (ver syncExistingTask acima) — existia na
  // planilha desde sempre, só nunca tinha sido lida.
  const idxDataAtualizacao = colIndex(headers, "Data de atualização");

  const result: TarefasImportResult = {
    created: 0,
    skippedNoOwner: 0,
    assigneeRowsExpanded: 0,
    updated: 0,
    skippedNoChange: 0,
    skippedOlderData: 0,
    skippedCompleted: 0,
  };

  // Pré-carga em bloco: deals (id + contactId por agendorDealId), contatos
  // (id por agendorContactId) e tarefas já importadas ((agendorTaskId,
  // ownerId) já existentes) — poucas consultas no total em vez de até 3 por
  // linha (e essa fase tem ~101 mil linhas, expandidas por responsável).
  // Paginado (ver findAllPaged) — mesmo motivo de import-negocios.ts: um
  // findMany sem paginação nessas tabelas grandes estoura o teto de 15s da
  // mini-transação do RLS num banco remoto (confirmado rodando de verdade).
  const [deals, contacts, existingTasks] = await Promise.all([
    findAllPaged((skip, take) =>
      prisma.deal.findMany({
        where: { agendorDealId: { not: null } },
        select: { id: true, agendorDealId: true, contactId: true },
        orderBy: { id: "asc" },
        skip,
        take,
      }),
    ),
    findAllPaged((skip, take) =>
      prisma.contact.findMany({
        where: { agendorContactId: { not: null } },
        select: { id: true, agendorContactId: true },
        orderBy: { id: "asc" },
        skip,
        take,
      }),
    ),
    findAllPaged((skip, take) =>
      prisma.task.findMany({
        where: { agendorTaskId: { not: null } },
        select: { id: true, agendorTaskId: true, ownerId: true, title: true, description: true, dueAt: true, completedAt: true, updatedAt: true },
        orderBy: { id: "asc" },
        skip,
        take,
      }),
    ),
  ]);
  const dealByAgendorId = new Map(deals.map((d) => [d.agendorDealId as string, { id: d.id, contactId: d.contactId }]));
  const contactByAgendorId = new Map(contacts.map((c) => [c.agendorContactId as string, c.id]));
  const existingTaskByKey = new Map<string, ExistingTaskSnapshot>(
    existingTasks.map((t) => [
      `${t.agendorTaskId}::${t.ownerId}`,
      { id: t.id, title: t.title, description: t.description, dueAt: t.dueAt, completedAt: t.completedAt, updatedAt: t.updatedAt },
    ]),
  );

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
    // Tarefa "pendente" no Agendor cujo prazo já passou há muito tempo não é
    // trabalho ativo de verdade — é debris histórico que nunca foi marcado
    // como feito/cancelado no sistema antigo. Sem isso, a Agenda do
    // consultor piloto ficaria com milhares de "atrasadas" de anos atrás
    // (confirmado: 98,5% das pendentes importadas já tinham vencido).
    const completedAt = cellDate(row, idxDataFinalizacao) ?? (dueAt && dueAt < new Date() ? dueAt : undefined);
    const createdAt = cellDate(row, idxDataCadastro) ?? undefined;
    const title = (descricao ?? (tipo || "Tarefa")).slice(0, TITLE_MAX_LEN);
    const rowUpdatedAt = cellDate(row, idxDataAtualizacao) ?? cellDate(row, idxDataCadastro);

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

      const existing = existingTaskByKey.get(`${codigoTarefa}::${ownerId}`);
      if (existing) {
        const outcome = await syncExistingTask(existing, codigoTarefa, { title, description: descricao, dueAt, rowUpdatedAt }, dryRun);
        result[outcome]++;
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
            createdAt,
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
