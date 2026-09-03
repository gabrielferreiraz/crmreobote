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
import { findAllPaged } from "@/scripts/agendor/pagination";

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
  // comparação e some em skippedNoChange/skippedByTimestamp.
  updated: number; // pelo menos 1 campo (etapa/status/valor) mudou de verdade
  skippedNoChange: number; // linha mais nova que o registro daqui, mas nada de fato diferente
  skippedByTimestamp: number; // "Ultima atualização" da planilha não é mais nova que Deal.updatedAt — não confiável o bastante pra sobrescrever (só no modo normal, não no forceSync)
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
  name: string;
  startedAt: Date | null;
};

type RowDealFields = {
  stage: { pipelineId: string; stageId: string; stageName: string } | null;
  status: $Enums.DealStatus;
  value: number | null;
  description: string | null;
  lostReason: string | null;
  rowUpdatedAt: Date | null;
  closedAtFromRow: Date | undefined;
  /** Resolvido antes do branch existingDeal pra estar disponível no forceSync. */
  ownerId: string | null;
  /** Título do negócio conforme o Agendor. */
  name: string;
  /** Data de início conforme o Agendor. */
  startedAt: Date | undefined;
};

/**
 * Compara o negócio já existente com o que a linha da planilha nova diz.
 *
 * Modo normal (forceSync=false): só aplica se rowUpdatedAt > existing.updatedAt,
 * nunca limpa valores, nunca reatribui responsável — comportamento conservador
 * igual ao original.
 *
 * Modo forceSync (forceSync=true): ignora a guarda de timestamp e força o
 * negócio a ficar EXATAMENTE como o arquivo do Agendor diz, inclusive:
 *   - Limpa value quando o Agendor não tem valor
 *   - Sobrescreve lostReason mesmo que já existisse
 *   - Seta/limpa closedAt conforme o status real
 *   - Reatribui ownerId se o Agendor diz outra pessoa
 *   - Atualiza name (título) e startedAt
 *
 * De propósito NÃO dispara nada externo (webhook deal.won/deal.lost,
 * evento de conversão pra Meta Ads, automação) — só grava o negócio e uma
 * Activity type=SYSTEM registrando o que mudou.
 */
async function syncExistingDeal(
  existing: ExistingDealSnapshot,
  codigoNegocio: string,
  fields: RowDealFields,
  dryRun: boolean,
  forceSync: boolean,
): Promise<"updated" | "skippedNoChange" | "skippedByTimestamp"> {
  // Modo normal: guarda de timestamp — só aplica se o arquivo tem dado mais recente.
  if (!forceSync) {
    if (!fields.rowUpdatedAt || fields.rowUpdatedAt <= existing.updatedAt) {
      return "skippedByTimestamp";
    }
  }

  const data: Prisma.DealUncheckedUpdateInput = {};
  const changeParts: string[] = [];

  // ── Etapa ──────────────────────────────────────────────────────────────────
  if (fields.stage && fields.stage.stageId !== existing.stageId) {
    data.pipelineId = fields.stage.pipelineId;
    data.stageId = fields.stage.stageId;
    // Backdated pro momento real da mudança (não "agora") — alcance histórico.
    data.stageEnteredAt = fields.rowUpdatedAt ?? undefined;
    changeParts.push(`etapa ${existing.stageName} → ${fields.stage.stageName}`);
  }

  // ── Status + closedAt + lostReason ────────────────────────────────────────
  if (fields.status !== existing.status) {
    data.status = fields.status;
    changeParts.push(
      `status → ${
        fields.status === "WON" ? "Ganho" : fields.status === "LOST" ? "Perdido" : "reaberto (Em andamento)"
      }`,
    );
  }

  // closedAt: no forceSync, seta sempre que o status não é OPEN (conforme
  // a data de conclusão real do Agendor) e limpa quando OPEN. No modo
  // normal, só seta se ainda não havia closedAt.
  if (forceSync) {
    if (fields.status !== "OPEN") {
      const expectedClosedAt = fields.closedAtFromRow ?? fields.rowUpdatedAt ?? undefined;
      // Date é objeto — comparar com !== sempre dá "diferente" mesmo com o
      // mesmo instante. Compara por valor (getTime()).
      if (expectedClosedAt && (!existing.closedAt || expectedClosedAt.getTime() !== existing.closedAt.getTime())) {
        data.closedAt = expectedClosedAt;
      }
    } else if (existing.closedAt) {
      // Agendor diz "Em andamento" mas no CRM estava fechado — reabre limpo.
      data.closedAt = null;
    }
  } else {
    if (fields.status !== "OPEN" && !existing.closedAt) {
      data.closedAt = fields.closedAtFromRow ?? fields.rowUpdatedAt;
    }
  }

  // lostReason: forceSync sempre sobrescreve; modo normal só seta se vazio.
  if (fields.status === "LOST" && fields.lostReason) {
    if (forceSync || !existing.lostReason) {
      if (fields.lostReason !== existing.lostReason) {
        data.lostReason = fields.lostReason;
        if (forceSync) changeParts.push(`motivo de perda atualizado`);
      }
    }
  } else if (forceSync && fields.status !== "LOST" && existing.lostReason) {
    // Agendor não é mais Perdido mas CRM tinha motivo de perda — limpa.
    data.lostReason = null;
  }

  // ── Valor ─────────────────────────────────────────────────────────────────
  // forceSync: limpa o valor se Agendor não tem (null). Modo normal: nunca
  // limpa (nunca grava null num campo que já tinha valor).
  if (forceSync) {
    if (fields.value !== existing.value) {
      data.value = fields.value;
      changeParts.push(fields.value === null ? `valor removido` : `valor atualizado`);
    }
  } else {
    if (fields.value !== null && fields.value !== existing.value) {
      data.value = fields.value;
      changeParts.push(`valor atualizado`);
    }
  }

  // ── Descrição ─────────────────────────────────────────────────────────────
  // Modo normal: nunca limpa (mesma regra de "nunca apaga" do resto da
  // função) — só sobrescreve se a planilha tem texto novo. forceSync: força
  // igual ao Agendor, inclusive limpando se a planilha estiver vazia.
  if (forceSync) {
    if (fields.description !== existing.description) {
      data.description = fields.description;
      // Não entra em changeParts — igual à rota PUT ao vivo.
    }
  } else if (fields.description && fields.description !== existing.description) {
    data.description = fields.description;
  }

  // ── Título (forceSync only) ────────────────────────────────────────────────
  if (forceSync && fields.name && fields.name !== existing.name) {
    data.name = fields.name;
  }

  // ── Responsável (forceSync only) ──────────────────────────────────────────
  if (forceSync && fields.ownerId && fields.ownerId !== existing.ownerId) {
    data.ownerId = fields.ownerId;
    changeParts.push(`responsável reatribuído`);
  }

  // ── startedAt (forceSync only) ─────────────────────────────────────────────
  if (
    forceSync &&
    fields.startedAt &&
    (!existing.startedAt || fields.startedAt.getTime() !== existing.startedAt.getTime())
  ) {
    data.startedAt = fields.startedAt;
  }

  // Único critério de "nada mudou": `data` não ganhou nenhum campo. Evita a
  // classe de bug de listar campo por campo aqui (um campo novo do forceSync
  // que esqueça de entrar nesta lista faria todo negócio "mudar" à toa).
  if (Object.keys(data).length === 0) {
    return "skippedNoChange";
  }

  if (dryRun) {
    const summary = changeParts.length > 0 ? changeParts.join("; ") : Object.keys(data).join(", ");
    console.log(`[negocios] (dry-run) sincronizaria (Código do Negócio ${codigoNegocio}): ${summary}`);
    return "updated";
  }

  // updatedAt explícito (histórico real, não "agora") — idempotência: numa
  // reexecução com o MESMO arquivo, existing.updatedAt já vai bater com
  // fields.rowUpdatedAt (não mais estritamente maior), então a guarda no
  // topo desta função pula sozinha no modo normal.
  if (fields.rowUpdatedAt) data.updatedAt = fields.rowUpdatedAt;

  await prisma.deal.update({ where: { id: existing.id }, data });
  if (changeParts.length > 0) {
    console.log(`[negocios] sincronizado (Código do Negócio ${codigoNegocio}): ${changeParts.join("; ")}`);
    await prisma.activity.create({
      data: {
        organizationId: ORGANIZATION_ID,
        dealId: existing.id,
        userId: data.ownerId ? (data.ownerId as string) : existing.ownerId,
        type: "SYSTEM",
        body: `Sincronizado do Agendor: ${changeParts.join("; ")}`,
        createdAt: fields.rowUpdatedAt ?? new Date(),
      },
    });
  }
  return "updated";
}

export async function importNegocios(
  negociosPath: string,
  canonicalMap: CanonicalMap,
  dryRun: boolean,
  /** Quando true: ignora a guarda de timestamp e força todos os campos do
   * negócio a ficarem EXATAMENTE como o arquivo do Agendor diz — inclusive
   * valor null, motivo de perda, responsável, título e data de início.
   * Quando false (padrão): comportamento conservador original. */
  forceSync = false,
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
    skippedByTimestamp: 0,
  };

  // Pré-carga em bloco (poucas consultas, não 1 por linha): negócios já
  // importados (agora com o suficiente pra decidir se sincroniza, não só um
  // Set de ids) + contatos existentes indexados pelas 3 chaves usadas na
  // resolução de contato abaixo. Isso é o que torna 117 mil linhas viável —
  // sem isso seriam ~3 consultas por linha só de leitura.
  //
  // PAGINADO (não um findMany só): cada operação do Prisma aqui roda dentro
  // de uma mini-transação de até 15s (SET_CONFIG do RLS, ver withTenantRls
  // em lib/prisma.ts) — um findMany sem paginação trazendo ~118 mil
  // negócios (11 colunas + JOIN em PipelineStage pro nome da etapa) ou ~140
  // mil contatos passa desse tempo em banco remoto e estoura
  // "Transaction API error: A commit cannot be executed on an expired
  // transaction" (confirmado rodando de verdade — não é hipotético).
  // Paginar dá a cada página sua própria janela de 15s do zero.
  const [existingDealsRaw, allContacts] = await Promise.all([
    findAllPaged((skip, take) =>
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
          name: true,
          startedAt: true,
        },
        orderBy: { id: "asc" },
        skip,
        take,
      }),
    ),
    findAllPaged((skip, take) =>
      prisma.contact.findMany({
        select: { id: true, agendorContactId: true, phoneNormalized: true, whatsappNormalized: true },
        orderBy: { id: "asc" },
        skip,
        take,
      }),
    ),
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
        name: d.name,
        startedAt: d.startedAt,
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
    const createdAtFromRow = cellDate(row, idxDataCadastro);
    const startedAt = cellDate(row, idxDataInicio) ?? createdAtFromRow ?? undefined;

    // Responsável resolvido ANTES do branch existingDeal — necessário pra
    // forceSync poder reatribuir o ownerId de negócios já existentes.
    // resolveUserId é memoizado (Map de promise), então o custo extra pra
    // linhas de negócios novos é mínimo.
    const responsavel = cellText(row, idxResponsavel);
    const ownerId = await resolveUserId(responsavel, dryRun);

    const existingDeal = existingDealByAgendorId.get(codigoNegocio);
    if (existingDeal) {
      const outcome = await syncExistingDeal(
        existingDeal,
        codigoNegocio,
        { stage, status, value, description, lostReason, rowUpdatedAt, closedAtFromRow, ownerId, name: titulo, startedAt },
        dryRun,
        forceSync,
      );
      // skippedByTimestamp mapeado do novo nome de retorno
      if (outcome === "skippedByTimestamp") {
        result.skippedByTimestamp++;
      } else {
        result[outcome]++;
      }
      return;
    }

    if (!stage) {
      // Negócio NOVO cujo funil/etapa não bate com nada mapeado — ao
      // contrário da sincronização, aqui não tem "deixar a etapa como
      // estava": não existe negócio ainda, não dá pra criar sem etapa.
      return;
    }

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

    const createdAt = createdAtFromRow ?? undefined;
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
          startedAt,
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
