/**
 * Importa Negócios do Agendor → Deal (+ Contact de apoio quando a pessoa
 * não existe/não tem telefone — ver as 3 ordens de resolução de contato
 * abaixo). Create-only por agendorDealId.
 */

import { prisma } from "@/lib/prisma";
import { $Enums } from "@/app/generated/prisma/client";
import { normalizePhoneNumber } from "@/lib/phone-normalize";
import { ORGANIZATION_ID, resolveUserId } from "@/scripts/agendor/users";
import { resolveStage } from "@/scripts/agendor/pipelines";
import { isCorruptedPhoneValue } from "@/scripts/agendor/value-corruption";
import { NO_CONTACT_TAG } from "@/scripts/agendor/import-pessoas";
import { type CanonicalMap, resolveCanonicalPersonId } from "@/scripts/agendor/phone-dedup";
import { loadSheet, getHeaders, colIndex, cellText, cellDate, cellNumber } from "@/scripts/agendor/xlsx-utils";
import { runConcurrent } from "@/scripts/agendor/concurrency";

const CONCURRENCY = 16;

const STATUS_MAP: Record<string, $Enums.DealStatus> = {
  "Em andamento": "OPEN",
  Ganho: "WON",
  Perdido: "LOST",
};

export type NegociosImportResult = {
  created: number;
  skippedAlreadyImported: number;
  skippedNoOwner: number;
  skippedBadStage: number;
  corruptedValueCount: number;
  contactByPhoneCount: number;
  contactNoInfoCount: number;
};

/** Varre só Código da Pessoa + Status — usado pra alimentar a regra de nome vazio em import-pessoas.ts. Roda ANTES da importação de pessoas de propósito. */
export async function scanWonDealPersonIds(negociosPath: string): Promise<Set<string>> {
  const sheet = await loadSheet(negociosPath);
  const headers = getHeaders(sheet);
  const idxCodigoPessoa = colIndex(headers, "Código da Pessoa");
  const idxStatus = colIndex(headers, "Status");

  const won = new Set<string>();
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (cellText(row, idxStatus) !== "Ganho") continue;
    const codigo = cellText(row, idxCodigoPessoa);
    if (codigo) won.add(codigo);
  }
  console.log(`[negocios] pré-passo: ${won.size} pessoa(s) distinta(s) com negócio Ganho.`);
  return won;
}

// Telefone normalizado -> promise do Contact.id, memoizado nesta execução.
// Igual à ideia de resolveUserId: duas linhas de negócio concorrentes com o
// MESMO telefone solto (sem Código da Pessoa) não podem cada uma tentar
// criar seu próprio contato — a segunda apanharia um unique constraint em
// whatsappNormalized. Guardando a promise em voo, a segunda só espera.
const phoneContactCache = new Map<string, Promise<string | null>>();

async function findOrCreateContactByPhone(
  phoneRaw: string,
  fallbackName: string,
  existingByPhone: Map<string, string>,
  dryRun: boolean,
): Promise<string | null> {
  const normalized = normalizePhoneNumber(phoneRaw);
  if (!normalized) return null;
  if (dryRun) return `dry-run:phone:${normalized}`;

  const known = existingByPhone.get(normalized);
  if (known) return known;

  const cached = phoneContactCache.get(normalized);
  if (cached) return cached;

  const promise = (async () => {
    const created = await prisma.contact.create({
      data: {
        organizationId: ORGANIZATION_ID,
        name: fallbackName,
        whatsapp: phoneRaw,
        whatsappNormalized: normalized,
      },
    });
    existingByPhone.set(normalized, created.id);
    return created.id;
  })();
  phoneContactCache.set(normalized, promise);
  try {
    return await promise;
  } catch (err) {
    phoneContactCache.delete(normalized);
    // Corrida rara: outro processo/linha já criou esse telefone entre a
    // checagem em memória e o create — reaproveita quem ganhou a corrida.
    const existing = await prisma.contact.findFirst({
      where: { organizationId: ORGANIZATION_ID, OR: [{ phoneNormalized: normalized }, { whatsappNormalized: normalized }] },
      select: { id: true },
    });
    if (existing) {
      existingByPhone.set(normalized, existing.id);
      return existing.id;
    }
    throw err;
  }
}

async function createNoContactPlaceholder(title: string, dryRun: boolean): Promise<string> {
  if (dryRun) return `dry-run:no-contact:${title}`;
  const created = await prisma.contact.create({
    data: { organizationId: ORGANIZATION_ID, name: title, tags: [NO_CONTACT_TAG] },
  });
  return created.id;
}

export async function importNegocios(
  negociosPath: string,
  canonicalMap: CanonicalMap,
  dryRun: boolean,
): Promise<NegociosImportResult> {
  const sheet = await loadSheet(negociosPath);
  const headers = getHeaders(sheet);

  const idxCodigoNegocio = colIndex(headers, "Código do Negócio");
  const idxTitulo = colIndex(headers, "Título do negócio");
  const idxResponsavel = colIndex(headers, "Usuário responsável");
  const idxDataInicio = colIndex(headers, "Data de início");
  const idxDataConclusao = colIndex(headers, "Data de conclusão");
  const idxDataCadastro = colIndex(headers, "Data de cadastro");
  const idxAtualizacao = colIndex(headers, "Ultima atualização");
  const idxValor = colIndex(headers, "Valor");
  const idxStatus = colIndex(headers, "Status");
  const idxFunil = colIndex(headers, "Funil");
  const idxEtapa = colIndex(headers, "Etapa");
  const idxDescricao = colIndex(headers, "Descrição");
  const idxMotivoPerda = colIndex(headers, "Motivo de perda");
  const idxDescMotivoPerda = colIndex(headers, "Descrição do motivo de perda");
  const idxCodigoPessoa = colIndex(headers, "Código da Pessoa");
  const idxWhatsapp2 = colIndex(headers, "WhatsApp", 2);
  const idxTelefone = colIndex(headers, "Telefone");
  const idxCelular = colIndex(headers, "Celular");

  const result: NegociosImportResult = {
    created: 0,
    skippedAlreadyImported: 0,
    skippedNoOwner: 0,
    skippedBadStage: 0,
    corruptedValueCount: 0,
    contactByPhoneCount: 0,
    contactNoInfoCount: 0,
  };

  // Pré-carga em bloco (1 consulta cada, não 1 por linha): negócios já
  // importados + contatos existentes indexados pelas 3 chaves usadas na
  // resolução de contato abaixo. Isso é o que torna 117 mil linhas viável —
  // sem isso seriam ~3 consultas por linha só de leitura.
  const [existingDealIds, allContacts] = await Promise.all([
    prisma.deal.findMany({ where: { agendorDealId: { not: null } }, select: { agendorDealId: true } }).then((rows) => new Set(rows.map((d) => d.agendorDealId as string))),
    prisma.contact.findMany({ select: { id: true, agendorContactId: true, phoneNormalized: true, whatsappNormalized: true } }),
  ]);
  const contactByAgendorId = new Map<string, string>();
  const contactByPhone = new Map<string, string>();
  for (const c of allContacts) {
    if (c.agendorContactId) contactByAgendorId.set(c.agendorContactId, c.id);
    if (c.phoneNormalized) contactByPhone.set(c.phoneNormalized, c.id);
    if (c.whatsappNormalized) contactByPhone.set(c.whatsappNormalized, c.id);
  }

  const rows: number[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) rows.push(r);

  await runConcurrent(rows, CONCURRENCY, async (r) => {
    const row = sheet.getRow(r);
    const codigoNegocio = cellText(row, idxCodigoNegocio);
    if (!codigoNegocio) return;

    if (existingDealIds.has(codigoNegocio)) {
      result.skippedAlreadyImported++;
      return;
    }

    const titulo = cellText(row, idxTitulo) ?? `Negócio ${codigoNegocio}`;
    const responsavel = cellText(row, idxResponsavel);
    const ownerId = await resolveUserId(responsavel, dryRun);
    if (!ownerId) {
      console.warn(`[negocios] pulado (sem Usuário responsável): Código do Negócio ${codigoNegocio}`);
      result.skippedNoOwner++;
      return;
    }

    // Resolve contato: (1) Código da Pessoa → contato já importado; (2) sem
    // pessoa mas com telefone solto → cria/casa por telefone; (3) nem um
    // nem outro → contato reconstruído só com o título, tag sem-contato.
    let contactId: string | null = null;
    const codigoPessoa = cellText(row, idxCodigoPessoa);
    if (codigoPessoa) {
      const canonical = resolveCanonicalPersonId(canonicalMap, codigoPessoa);
      contactId = dryRun ? `dry-run:person:${canonical}` : (contactByAgendorId.get(canonical) ?? null);
    }
    if (!contactId) {
      const phone = cellText(row, idxWhatsapp2) ?? cellText(row, idxCelular) ?? cellText(row, idxTelefone);
      if (phone) {
        contactId = await findOrCreateContactByPhone(phone, titulo, contactByPhone, dryRun);
        if (contactId) result.contactByPhoneCount++;
      }
    }
    if (!contactId) {
      contactId = await createNoContactPlaceholder(titulo, dryRun);
      result.contactNoInfoCount++;
    }

    const funil = cellText(row, idxFunil);
    const etapa = cellText(row, idxEtapa);
    let stage: { pipelineId: string; stageId: string };
    try {
      stage = resolveStage(funil ?? "", etapa ?? "");
    } catch (err) {
      console.warn(`[negocios] pulado (funil/etapa não mapeado): Código do Negócio ${codigoNegocio} — ${err instanceof Error ? err.message : err}`);
      result.skippedBadStage++;
      return;
    }

    const statusRaw = cellText(row, idxStatus) ?? "";
    const status = STATUS_MAP[statusRaw] ?? "OPEN";

    let value: number | null = cellNumber(row, idxValor);
    if (value !== null && isCorruptedPhoneValue(value)) {
      console.warn(`[negocios] valor corrompido (telefone no campo Valor) ignorado: Código do Negócio ${codigoNegocio}, valor bruto=${value}`);
      result.corruptedValueCount++;
      value = null;
    }

    const motivoPerda = cellText(row, idxMotivoPerda);
    const descMotivoPerda = cellText(row, idxDescMotivoPerda);
    const lostReason = motivoPerda ? (descMotivoPerda ? `${motivoPerda}: ${descMotivoPerda}` : motivoPerda) : null;

    if (dryRun) {
      result.created++;
      return;
    }

    const createdAt = cellDate(row, idxDataCadastro) ?? undefined;
    const updatedAt = cellDate(row, idxAtualizacao) ?? createdAt;

    try {
      await prisma.deal.create({
        data: {
          organizationId: ORGANIZATION_ID,
          pipelineId: stage.pipelineId,
          stageId: stage.stageId,
          contactId,
          ownerId,
          name: titulo,
          status,
          value: value ?? undefined,
          description: cellText(row, idxDescricao),
          lostReason,
          startedAt: cellDate(row, idxDataInicio) ?? createdAt,
          closedAt: cellDate(row, idxDataConclusao) ?? undefined,
          stageEnteredAt: updatedAt,
          createdAt,
          updatedAt,
          agendorDealId: codigoNegocio,
        },
      });
      result.created++;
    } catch (err) {
      console.error(`[negocios] falha ao criar negócio (Código do Negócio ${codigoNegocio}):`, err instanceof Error ? err.message : err);
    }
  });

  return result;
}
