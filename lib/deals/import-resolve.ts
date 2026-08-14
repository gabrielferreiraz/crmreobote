/**
 * Motor de resolução da importação de negócios — puro (nenhuma escrita no
 * banco aqui, só leitura já feita pelo chamador), usado tanto pela prévia
 * (POST /api/deals/import/preview, mostra o plano antes de gravar) quanto
 * pelo commit de verdade (POST /api/deals/import, ver route.ts) — as duas
 * rotas chamam exatamente essa mesma função, então o que a prévia mostra é
 * garantidamente o mesmo cálculo que vai gravar (nunca duas lógicas
 * paralelas se desalinhando com o tempo).
 *
 * Deliberadamente NÃO tenta ser "o plano trava, a confirmação só replica" —
 * o commit roda esta função de novo do zero (mesmo arquivo reenviado pelo
 * navegador, ver ImportDialog) contra o estado ATUAL do banco. Entre a
 * prévia e a confirmação alguém pode ter cadastrado um contato novo que
 * colide, por exemplo — reprocessar do zero garante que a decisão final
 * sempre reflete a realidade no momento de gravar, não uma foto congelada.
 */

import { normalizeHeader } from "@/lib/parse-spreadsheet";
import { normalizePhoneNumber, brazilianMobileVariants } from "@/lib/phone-normalize";
import { parseBrazilianCurrency } from "@/lib/format";
import { buildDealName } from "@/lib/deal-name";

export type ImportField =
  | "contact"
  | "phone"
  | "whatsapp"
  | "email"
  | "source"
  | "dealName"
  | "value"
  | "creditType"
  | "stage"
  | "owner";

const FIELD_META: Record<ImportField, { candidates: string[]; required: boolean; label: string }> = {
  contact: { required: true, label: "Contato", candidates: ["contato", "cliente", "nome do contato", "nome"] },
  phone: {
    required: false,
    label: "Telefone",
    candidates: ["telefone", "celular", "phone", "fone", "celular 2", "celular2", "telefone 2", "telefone2", "segundo celular", "segundo telefone"],
  },
  whatsapp: { required: false, label: "WhatsApp", candidates: ["whatsapp", "whats"] },
  email: { required: false, label: "E-mail", candidates: ["email", "e-mail"] },
  source: { required: false, label: "Origem", candidates: ["origem", "source"] },
  dealName: { required: false, label: "Nome do negócio", candidates: ["negocio", "nome do negocio", "titulo"] },
  value: { required: false, label: "Valor", candidates: ["valor", "value"] },
  creditType: { required: false, label: "Tipo de crédito", candidates: ["tipo de credito", "tipo", "credittype"] },
  stage: { required: false, label: "Etapa", candidates: ["etapa", "stage"] },
  owner: { required: false, label: "Responsável", candidates: ["responsavel", "vendedor", "owner"] },
};

export const IMPORT_FIELDS = Object.keys(FIELD_META) as ImportField[];

export type ColumnDetection = {
  field: ImportField;
  label: string;
  required: boolean;
  /** índice na linha de cabeçalho ORIGINAL (não normalizada) do arquivo — -1 = não encontrada. */
  index: number;
  /** Texto do cabeçalho como veio no arquivo, só pra exibir "achei 'Fone' pra Telefone" na prévia. */
  headerLabel: string | null;
};

/**
 * Acha a coluna de cada campo — `overrides` (índice 0-based na linha de
 * cabeçalho) tem prioridade sobre a detecção automática por sinônimo, é
 * como o usuário corrige na tela de prévia quando o cabeçalho do arquivo
 * dele não bate com nenhum sinônimo conhecido (ver ColumnMappingFix no
 * componente de prévia).
 */
export function detectColumns(rawHeaderRow: string[], overrides?: Partial<Record<ImportField, number>>): ColumnDetection[] {
  const normalizedHeaderRow = rawHeaderRow.map(normalizeHeader);
  return IMPORT_FIELDS.map((field) => {
    const meta = FIELD_META[field];
    const overrideIndex = overrides?.[field];
    const index =
      overrideIndex !== undefined && overrideIndex >= 0 && overrideIndex < rawHeaderRow.length
        ? overrideIndex
        : normalizedHeaderRow.findIndex((h) => meta.candidates.includes(h));
    return {
      field,
      label: meta.label,
      required: meta.required,
      index,
      headerLabel: index >= 0 ? rawHeaderRow[index] : null,
    };
  });
}

export type RowIssueCode =
  | "NO_CONTACT_NAME"
  | "DUPLICATE_DEAL"
  | "STAGE_NOT_FOUND"
  | "OWNER_NOT_FOUND"
  | "VALUE_UNREADABLE";

export type ResolvedRow = {
  /** 1-based, contando a linha de cabeçalho como 1 — bate com o número de linha que a pessoa vê ao abrir a planilha. */
  rowNumber: number;
  willImport: boolean;
  contactName: string | null;
  contactStatus: "existing" | "new" | null;
  dealName: string | null;
  stageName: string | null;
  ownerName: string | null;
  value: number | null;
  issues: { code: RowIssueCode; message: string }[];
};

export type ImportPlanSummary = {
  totalRows: number;
  toCreate: number;
  newContacts: number;
  existingContactsMatched: number;
  duplicateDeals: number;
  skippedNoContact: number;
  stageFallbacks: number;
  ownerFallbacks: number;
  valueParseFailures: number;
};

export type ImportPlan = {
  columns: ColumnDetection[];
  missingRequiredColumns: ColumnDetection[];
  summary: ImportPlanSummary;
  rows: ResolvedRow[];
  /** Preenchido só na resolução de commit — o que efetivamente sai pro banco (ver applyImportPlan em route.ts). Ausente na prévia (a prévia não precisa disso, só do resumo/linhas acima). */
  writes?: {
    newContacts: {
      pendingIndex: number;
      name: string;
      phone?: string;
      whatsapp?: string;
      email?: string;
      source?: string;
      phoneNormalized: string | null;
      whatsappNormalized: string | null;
    }[];
    /** contactRef por linha de dado (mesmo índice de `rows`, já alinhado) — "existing" aponta pro id de verdade, "new" aponta pro índice em `newContacts`. */
    rowContactRefs: ({ kind: "existing"; id: string } | { kind: "new"; pendingIndex: number } | null)[];
    /** Linhas que vão virar Deal de fato (exclui NO_CONTACT_NAME e DUPLICATE_DEAL) — já com tudo resolvido, só falta o contactId real (que só existe depois de criar os contatos novos). */
    dealPlans: {
      rowIndex: number;
      stageId: string;
      ownerId: string;
      name: string;
      value?: number;
      creditType?: string;
    }[];
  };
};

export type ExistingContactInput = {
  id: string;
  name: string;
  source: string | null;
  whatsappNormalized: string | null;
};

export type MemberInput = { userId: string; name: string; email: string };

export type ResolveImportInput = {
  dataRows: string[][];
  rawHeaderRow: string[];
  columnOverrides?: Partial<Record<ImportField, number>>;
  /**
   * Valor único aplicado em TODA linha cuja célula do campo veio vazia —
   * seja porque a coluna nem existe no arquivo (o caso que motivou isso:
   * planilha sem coluna "responsavel", em vez de sortear owner/deixar sem
   * origem em silêncio, pergunta uma vez só "quem é o responsável de
   * todo mundo?") seja porque só aquela linha específica veio em branco
   * numa coluna que existe. Só faz sentido pra campo que tem um valor
   * plausível "pra todo mundo" — owner/stage/source/creditType (nunca
   * contact/phone/whatsapp/email/dealName/value, que são inerentemente por
   * linha). Ausente/vazio em qualquer campo = comportamento de sempre
   * (rodízio automático de responsável, 1ª etapa do funil, sem origem).
   */
  fieldDefaults?: Partial<Record<"owner" | "stage" | "source" | "creditType", string>>;
  stages: { id: string; name: string }[];
  members: MemberInput[];
  existingContacts: ExistingContactInput[];
  /** contactId de quem já tem negócio ABERTO nesta pipeline — usado pro alerta de duplicidade (ver DUPLICATE_DEAL). */
  contactIdsWithOpenDeal: Set<string>;
  /** ownerId → quantos negócios abertos tem agora, pro rodízio de responsável — mesma lógica de lib/auto-assign.ts, resolvida uma vez em memória. */
  openLoadByOwnerId: Map<string, number>;
  /** Usado só se `members` estiver vazio (organização sem nenhum membro ativo — não deveria acontecer, mas não pode travar por causa disso). */
  fallbackOwnerId: string;
  /** Precisa incluir a linha de cabeçalho — só usado pra devolver `rows[].rowNumber` corretamente alinhado ao arquivo original. */
  includeWrites: boolean;
};

/** Constrói o plano inteiro — mesma função pra prévia (includeWrites: false) e commit (includeWrites: true). */
export function resolveImportPlan(input: ResolveImportInput): ImportPlan {
  const columns = detectColumns(input.rawHeaderRow, input.columnOverrides);
  const byField = new Map(columns.map((c) => [c.field, c]));
  const missingRequiredColumns = columns.filter((c) => c.required && c.index === -1);

  const cell = (row: string[], field: ImportField) => {
    const idx = byField.get(field)!.index;
    return idx === -1 ? "" : (row[idx] ?? "").trim();
  };

  const stageByName = new Map(input.stages.map((s) => [normalizeHeader(s.name), s.id]));
  const defaultStageId = input.stages[0]?.id ?? "";
  const memberByName = new Map(input.members.map((m) => [normalizeHeader(m.name), m.userId]));
  const memberByEmail = new Map(input.members.map((m) => [m.email.toLowerCase(), m.userId]));

  const loadByUser = new Map(input.openLoadByOwnerId);
  function pickAutoOwner(): string {
    if (input.members.length === 0) return input.fallbackOwnerId;
    let picked = input.members[0].userId;
    let lowest = loadByUser.get(picked) ?? 0;
    for (const m of input.members) {
      const count = loadByUser.get(m.userId) ?? 0;
      if (count < lowest) {
        lowest = count;
        picked = m.userId;
      }
    }
    loadByUser.set(picked, (loadByUser.get(picked) ?? 0) + 1);
    return picked;
  }

  // Reconhece contato já existente (ou já resolvido numa linha anterior
  // deste mesmo arquivo) SÓ pelo campo WhatsApp — de propósito, por
  // decisão explícita: nem Telefone (é o campo "número 2/backup", texto
  // livre, mais fácil de vir errado ou reaproveitado) nem E-mail (mais
  // fácil de bater errado também, ex.: e-mail genérico da empresa
  // reaproveitado por mais de uma pessoa) entram como critério de
  // identidade aqui. Registro por variante de dígito (9º dígito do
  // celular) — mesmo motivo de sempre (ver phone-normalize.ts): planilha
  // com número num formato diferente do já salvo precisa reconhecer o
  // mesmo contato, não criar um segundo.
  //
  // Telefone continua sendo GRAVADO no contato normalmente (ver
  // newContacts abaixo) — só não é usado pra DECIDIR se é o mesmo contato.
  // Como Contact.phoneNormalized ainda tem constraint única no banco (é
  // usado em outros fluxos do CRM), duas linhas deste arquivo com o mesmo
  // telefone mas WhatsApp diferente/ausente podem colidir só na hora de
  // gravar — tratado como caso raro pela recuperação de "strays" que já
  // existe no commit (ver route.ts) + a deduplicação final de negócio por
  // contactId logo antes do createMany, que fecha esse buraco.
  type ContactRef =
    | { kind: "existing"; id: string; name: string; source: string | null }
    | { kind: "new"; pendingIndex: number; name: string; source: string | null };
  const refByWhatsapp = new Map<string, ContactRef>();
  function registerWhatsapp(normalized: string | null, ref: ContactRef) {
    if (!normalized) return;
    for (const variant of brazilianMobileVariants(normalized)) refByWhatsapp.set(variant, ref);
  }
  function lookupWhatsapp(normalized: string | null): ContactRef | undefined {
    if (!normalized) return undefined;
    for (const variant of brazilianMobileVariants(normalized)) {
      const ref = refByWhatsapp.get(variant);
      if (ref) return ref;
    }
    return undefined;
  }

  for (const c of input.existingContacts) {
    registerWhatsapp(c.whatsappNormalized, { kind: "existing", id: c.id, name: c.name, source: c.source });
  }

  const newContacts: NonNullable<ImportPlan["writes"]>["newContacts"] = [];
  const rows: ResolvedRow[] = [];
  const rowContactRefs: NonNullable<ImportPlan["writes"]>["rowContactRefs"] = [];
  const dealPlans: NonNullable<ImportPlan["writes"]>["dealPlans"] = [];

  const contactIdsWithDealThisRun = new Set(input.contactIdsWithOpenDeal);
  // Contato NOVO (ainda sem id real) que já ganhou um negócio nesta mesma
  // leva — evita 2 negócios pro mesmo contato quando duas linhas do
  // arquivo resolvem pro mesmo telefone/e-mail sem ainda existir no banco.
  const newContactPendingIndexWithDeal = new Set<number>();

  let toCreate = 0;
  let newContactCount = 0;
  let existingContactCount = 0;
  let duplicateDeals = 0;
  let skippedNoContact = 0;
  let stageFallbacks = 0;
  let ownerFallbacks = 0;
  let valueParseFailures = 0;

  for (let i = 0; i < input.dataRows.length; i++) {
    const row = input.dataRows[i];
    const rowNumber = i + 2; // +1 pelo cabeçalho, +1 porque rowNumber é 1-based
    const issues: ResolvedRow["issues"] = [];

    const contactName = cell(row, "contact");
    if (!contactName) {
      skippedNoContact += 1;
      issues.push({ code: "NO_CONTACT_NAME", message: "Sem nome de contato — linha ignorada" });
      rows.push({ rowNumber, willImport: false, contactName: null, contactStatus: null, dealName: null, stageName: null, ownerName: null, value: null, issues });
      rowContactRefs.push(null);
      continue;
    }

    const phone = cell(row, "phone") || undefined;
    const whatsapp = cell(row, "whatsapp") || undefined;
    const email = cell(row, "email") || undefined;
    const source = cell(row, "source") || input.fieldDefaults?.source || undefined;
    const phoneNormalized = normalizePhoneNumber(phone);
    const whatsappNormalized = normalizePhoneNumber(whatsapp);

    let ref: ContactRef | undefined = lookupWhatsapp(whatsappNormalized);

    let contactStatus: "existing" | "new";
    if (ref) {
      contactStatus = ref.kind;
    } else {
      const pendingIndex = newContacts.length;
      newContacts.push({ pendingIndex, name: contactName, phone, whatsapp, email, source, phoneNormalized, whatsappNormalized });
      const newRef: ContactRef = { kind: "new", pendingIndex, name: contactName, source: source ?? null };
      registerWhatsapp(whatsappNormalized, newRef);
      ref = newRef;
      contactStatus = "new";
    }

    const stageNameRaw = cell(row, "stage");
    let stageId = input.fieldDefaults?.stage && input.stages.some((s) => s.id === input.fieldDefaults!.stage) ? input.fieldDefaults.stage : defaultStageId;
    let stageName = input.stages.find((s) => s.id === stageId)?.name ?? null;
    if (stageNameRaw) {
      const matched = stageByName.get(normalizeHeader(stageNameRaw));
      if (matched) {
        stageId = matched;
        stageName = input.stages.find((s) => s.id === matched)?.name ?? stageNameRaw;
      } else {
        stageFallbacks += 1;
        issues.push({ code: "STAGE_NOT_FOUND", message: `Etapa "${stageNameRaw}" não existe nesse funil — caiu na etapa padrão` });
      }
    }

    const ownerNameRaw = cell(row, "owner");
    let ownerId = ownerNameRaw ? (memberByEmail.get(ownerNameRaw.toLowerCase()) ?? memberByName.get(normalizeHeader(ownerNameRaw))) : undefined;
    if (!ownerId) {
      if (ownerNameRaw) {
        ownerFallbacks += 1;
        issues.push({ code: "OWNER_NOT_FOUND", message: `Responsável "${ownerNameRaw}" não encontrado — distribuído automaticamente` });
      }
      const defaultOwner = input.fieldDefaults?.owner;
      ownerId = defaultOwner && input.members.some((m) => m.userId === defaultOwner) ? defaultOwner : pickAutoOwner();
    }
    const ownerName = input.members.find((m) => m.userId === ownerId)?.name ?? null;

    const valueRaw = cell(row, "value");
    const value = valueRaw ? parseBrazilianCurrency(valueRaw) : undefined;
    if (valueRaw && value === undefined) {
      valueParseFailures += 1;
      issues.push({ code: "VALUE_UNREADABLE", message: `Valor "${valueRaw}" não reconhecido — negócio criado sem valor` });
    }

    const dealNameRaw = cell(row, "dealName");
    const dealName = dealNameRaw || buildDealName(contactName, source);

    // Já tem negócio aberto nesse funil pra esse mesmo contato (no banco, ou
    // criado por uma linha ANTERIOR deste mesmo arquivo)? Não cria outro.
    const alreadyHasDeal =
      (ref.kind === "existing" && contactIdsWithDealThisRun.has(ref.id)) ||
      (ref.kind === "new" && newContactPendingIndexWithDeal.has(ref.pendingIndex));

    if (contactStatus === "existing") existingContactCount += 1;
    else newContactCount += 1;

    if (alreadyHasDeal) {
      duplicateDeals += 1;
      issues.push({ code: "DUPLICATE_DEAL", message: "Esse contato já tem negócio aberto neste funil — negócio não duplicado" });
      rows.push({ rowNumber, willImport: false, contactName, contactStatus, dealName, stageName, ownerName, value: value ?? null, issues });
      rowContactRefs.push(ref.kind === "existing" ? { kind: "existing", id: ref.id } : { kind: "new", pendingIndex: ref.pendingIndex });
      continue;
    }

    if (ref.kind === "existing") contactIdsWithDealThisRun.add(ref.id);
    else newContactPendingIndexWithDeal.add(ref.pendingIndex);

    toCreate += 1;
    rows.push({ rowNumber, willImport: true, contactName, contactStatus, dealName, stageName, ownerName, value: value ?? null, issues });
    rowContactRefs.push(ref.kind === "existing" ? { kind: "existing", id: ref.id } : { kind: "new", pendingIndex: ref.pendingIndex });
    const creditType = cell(row, "creditType") || input.fieldDefaults?.creditType || undefined;
    dealPlans.push({ rowIndex: i, stageId, ownerId, name: dealName, value, creditType });
  }

  const summary: ImportPlanSummary = {
    totalRows: input.dataRows.length,
    toCreate,
    newContacts: newContactCount,
    existingContactsMatched: existingContactCount,
    duplicateDeals,
    skippedNoContact,
    stageFallbacks,
    ownerFallbacks,
    valueParseFailures,
  };

  return {
    columns,
    missingRequiredColumns,
    summary,
    rows,
    writes: input.includeWrites ? { newContacts, rowContactRefs, dealPlans } : undefined,
  };
}
