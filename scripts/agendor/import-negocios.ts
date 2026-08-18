/**
 * Importa Negócios do Agendor → Deal (+ Contact de apoio quando a pessoa
 * não existe/não tem telefone — ver as 3 ordens de resolução de contato
 * abaixo). Por agendorDealId: cria se não existe, ou SINCRONIZA (etapa/
 * status/valor) se já existe e a planilha nova tem dado mais recente — ver
 * syncExistingDeal abaixo pra regra completa. Nunca some com nada: um
 * negócio que sumiu da planilha nova não é tocado (não apaga, não fecha,
 * não reabre sozinho).
 */

import { prisma } from "@/lib/prisma";
import { $Enums, Prisma } from "@/app/generated/prisma/client";
import { normalizePhoneNumber } from "@/lib/phone-normalize";
import { ORGANIZATION_ID, resolveUserId } from "@/scripts/agendor/users";
import { resolveStage, normalizeStageName } from "@/scripts/agendor/pipelines";
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
  skippedNoOwner: number;
  skippedBadStage: number;
  corruptedValueCount: number;
  contactByPhoneCount: number;
  contactNoInfoCount: number;
  // Negócio já existente (agendorDealId já importado) SEMPRE cai numa
  // dessas três — ver syncExistingDeal. Não existe mais "pulado, já
  // importado" simples: mesmo sem mudança nenhuma, a linha passa pela
  // comparação e some em skippedNoChange/skippedOlderData.
  updated: number; // pelo menos 1 campo (etapa/status/valor) mudou de verdade
  skippedNoChange: number; // linha mais nova que o registro daqui, mas nada de fato diferente
  skippedOlderData: number; // "Ultima atualização" da planilha não é mais nova que Deal.updatedAt — não confiável o bastante pra sobrescrever
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

type ExistingDealSnapshot = {
  id: string;
  ownerId: string;
  pipelineId: string;
  stageId: string;
  stageName: string;
  status: $Enums.DealStatus;
  value: number | null;
  description: string | null;
  lostReason: string | null;
  closedAt: Date | null;
  updatedAt: Date;
};

type RowDealFields = {
  stage: { pipelineId: string; stageId: string; stageName: string } | null;
  status: $Enums.DealStatus;
  value: number | null;
  description: string | null;
  lostReason: string | null;
  rowUpdatedAt: Date | null;
  closedAtFromRow: Date | undefined;
};

/**
 * Compara o negócio já existente com o que a linha da planilha nova diz e
 * aplica só o que de fato mudou — nunca apaga (um campo vazio na planilha
 * nova nunca limpa um valor que já existe aqui) e nunca reatribui
 * responsável (fora de escopo, decisão explícita: reatribuição tem peso de
 * negócio — comissão, quem fala com o cliente — grande demais pra decidir
 * sozinho a partir de uma coluna de planilha).
 *
 * Guarda de segurança: só mexe se `rowUpdatedAt` for mais recente que
 * `existing.updatedAt` — sem isso, um negócio que já avançou aqui no CRM
 * (updatedAt bate automaticamente a cada mudança, ver @updatedAt no schema)
 * poderia ser silenciosamente revertido por um dado desatualizado do
 * Agendor, inclusive reabrindo um negócio já Ganho/Perdido de verdade.
 * Dentro dessa guarda, uma transição de status (inclusive reabrir
 * Ganho/Perdido) É aplicada — decisão explícita do usuário: confiar no
 * timestamp mais recente, mesmo quando isso significa mudar um status já
 * fechado.
 *
 * De propósito NÃO dispara nada externo (webhook deal.won/deal.lost,
 * evento de conversão pra Meta Ads, automação) — só grava o negócio e uma
 * Activity type=SYSTEM registrando o que mudou, pra não soar como uma ação
 * "acabou de acontecer" pra sistemas de fora quando na real é um alcance
 * histórico de dado que já tinha acontecido há tempo (decisão explícita do
 * usuário). Também não valida requiredFields da etapa (essa checagem é uma
 * trava de UX pra ação ao vivo — o negócio JÁ chegou nessa etapa de
 * verdade no Agendor, não faz sentido bloquear registrar isso por causa de
 * uma exigência de campo configurada depois).
 */
async function syncExistingDeal(
  existing: ExistingDealSnapshot,
  codigoNegocio: string,
  fields: RowDealFields,
  dryRun: boolean,
): Promise<"updated" | "skippedNoChange" | "skippedOlderData"> {
  if (!fields.rowUpdatedAt || fields.rowUpdatedAt <= existing.updatedAt) {
    return "skippedOlderData";
  }

  const data: Prisma.DealUncheckedUpdateInput = {};
  const changeParts: string[] = [];

  if (fields.stage && fields.stage.stageId !== existing.stageId) {
    data.pipelineId = fields.stage.pipelineId;
    data.stageId = fields.stage.stageId;
    // Backdated pro momento real da mudança (não "agora") — isto é um
    // alcance de histórico, não uma ação ao vivo; ver stageEnteredAt na
    // criação (mesma lógica) pra consistência.
    data.stageEnteredAt = fields.rowUpdatedAt;
    changeParts.push(`etapa ${existing.stageName} → ${fields.stage.stageName}`);
  }

  if (fields.status !== existing.status) {
    data.status = fields.status;
    if (fields.status !== "OPEN" && !existing.closedAt) {
      data.closedAt = fields.closedAtFromRow ?? fields.rowUpdatedAt;
    }
    if (fields.status === "LOST" && fields.lostReason && !existing.lostReason) {
      data.lostReason = fields.lostReason;
    }
    const statusLabel = fields.status === "WON" ? "Ganho" : fields.status === "LOST" ? "Perdido" : "reaberto (Em andamento)";
    changeParts.push(`status → ${statusLabel}`);
  }

  if (fields.value !== null && fields.value !== existing.value) {
    data.value = fields.value;
    changeParts.push(`valor atualizado`);
  }

  if (fields.description && fields.description !== existing.description) {
    data.description = fields.description;
    // Não entra em changeParts/Activity — a rota PUT ao vivo (app/api/deals/[id]/route.ts)
    // também não registra edição de descrição como marco na timeline, só
    // mudança de etapa/status/valor. Mantido consistente aqui.
  }

  if (changeParts.length === 0) return "skippedNoChange";

  if (dryRun) {
    console.log(`[negocios] (dry-run) sincronizaria (Código do Negócio ${codigoNegocio}): ${changeParts.join("; ")}`);
    return "updated";
  }

  // updatedAt explícito (histórico real, não "agora") — Prisma aceita
  // sobrescrever um campo @updatedAt quando o valor vem explícito no
  // `data`. Importante pra idempotência: numa reexecução com o MESMO
  // arquivo, existing.updatedAt já vai bater com fields.rowUpdatedAt (não
  // mais estritamente maior), então a guarda no topo desta função pula
  // sozinha sem precisar de nenhum estado extra.
  data.updatedAt = fields.rowUpdatedAt;

  await prisma.deal.update({ where: { id: existing.id }, data });
  console.log(`[negocios] sincronizado (Código do Negócio ${codigoNegocio}): ${changeParts.join("; ")}`);
  await prisma.activity.create({
    data: {
      organizationId: ORGANIZATION_ID,
      dealId: existing.id,
      // Atribuído ao responsável do negócio (não existe um "usuário do
      // sistema" dedicado neste app) — é o que aconteceu com o negócio
      // dele, mesmo que ele não tenha clicado em nada aqui agora.
      userId: existing.ownerId,
      type: "SYSTEM",
      body: `Sincronizado do Agendor: ${changeParts.join("; ")}`,
      createdAt: fields.rowUpdatedAt,
    },
  });
  return "updated";
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
    skippedNoOwner: 0,
    skippedBadStage: 0,
    corruptedValueCount: 0,
    contactByPhoneCount: 0,
    contactNoInfoCount: 0,
    updated: 0,
    skippedNoChange: 0,
    skippedOlderData: 0,
  };

  // Pré-carga em bloco (1 consulta cada, não 1 por linha): negócios já
  // importados (agora com o suficiente pra decidir se sincroniza, não só um
  // Set de ids) + contatos existentes indexados pelas 3 chaves usadas na
  // resolução de contato abaixo. Isso é o que torna 117 mil linhas viável —
  // sem isso seriam ~3 consultas por linha só de leitura.
  const [existingDealsRaw, allContacts] = await Promise.all([
    prisma.deal.findMany({
      where: { agendorDealId: { not: null } },
      select: {
        id: true,
        agendorDealId: true,
        ownerId: true,
        pipelineId: true,
        stageId: true,
        stage: { select: { name: true } },
        status: true,
        value: true,
        description: true,
        lostReason: true,
        closedAt: true,
        updatedAt: true,
      },
    }),
    prisma.contact.findMany({ select: { id: true, agendorContactId: true, phoneNormalized: true, whatsappNormalized: true } }),
  ]);
  const existingDealByAgendorId = new Map<string, ExistingDealSnapshot>(
    existingDealsRaw.map((d) => [
      d.agendorDealId as string,
      {
        id: d.id,
        ownerId: d.ownerId,
        pipelineId: d.pipelineId,
        stageId: d.stageId,
        stageName: d.stage.name,
        status: d.status,
        value: d.value != null ? Number(d.value) : null,
        description: d.description,
        lostReason: d.lostReason,
        closedAt: d.closedAt,
        updatedAt: d.updatedAt,
      },
    ]),
  );
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

    const titulo = cellText(row, idxTitulo) ?? `Negócio ${codigoNegocio}`;

    // Campos possivelmente úteis pros dois caminhos (criar OU sincronizar) —
    // resolvidos uma vez só, antes de saber qual caminho vai seguir.
    const funil = cellText(row, idxFunil);
    const etapa = cellText(row, idxEtapa);
    let stage: { pipelineId: string; stageId: string; stageName: string } | null = null;
    try {
      const resolved = resolveStage(funil ?? "", etapa ?? "");
      stage = { ...resolved, stageName: normalizeStageName(etapa ?? "") };
    } catch (err) {
      console.warn(`[negocios] funil/etapa não mapeado: Código do Negócio ${codigoNegocio} — ${err instanceof Error ? err.message : err}`);
      result.skippedBadStage++;
      // Segue mesmo assim pro caminho de sincronização (status/valor ainda
      // podem ser aplicados) — só não mexe na etapa. No caminho de criação
      // (negócio novo) isso ainda impede criar, igual antes.
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
    const rowUpdatedAt = cellDate(row, idxAtualizacao) ?? cellDate(row, idxDataCadastro);
    const closedAtFromRow = cellDate(row, idxDataConclusao) ?? undefined;
    const description = cellText(row, idxDescricao);

    const existingDeal = existingDealByAgendorId.get(codigoNegocio);
    if (existingDeal) {
      const outcome = await syncExistingDeal(
        existingDeal,
        codigoNegocio,
        { stage, status, value, description, lostReason, rowUpdatedAt, closedAtFromRow },
        dryRun,
      );
      result[outcome]++;
      return;
    }

    if (!stage) {
      // Negócio NOVO cujo funil/etapa não bate com nada mapeado — ao
      // contrário da sincronização, aqui não tem "deixar a etapa como
      // estava": não existe negócio ainda, não dá pra criar sem etapa.
      return;
    }

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

    if (dryRun) {
      result.created++;
      return;
    }

    const createdAt = cellDate(row, idxDataCadastro) ?? undefined;
    const updatedAt = rowUpdatedAt ?? createdAt;

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
          description,
          lostReason,
          startedAt: cellDate(row, idxDataInicio) ?? createdAt,
          closedAt: closedAtFromRow,
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
