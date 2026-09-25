/**
 * Motor de resolução da importação de contatos — mesmo espírito de
 * lib/deals/import-resolve.ts (puro, sem escrita no banco), usado tanto pela
 * prévia (POST /api/contacts/import/preview) quanto pelo commit de verdade
 * (POST /api/contacts/import) — as duas rotas chamam exatamente esta mesma
 * função, então o que a prévia mostra é garantidamente o mesmo cálculo que
 * vai gravar.
 *
 * Mais simples que o de negócios de propósito: contato não tem etapa,
 * responsável nem "já tem X aberto" pra resolver — só nome/cargo
 * obrigatórios e a mesma constraint única do banco (telefone OU whatsapp)
 * que decide se uma linha colide com um contato já existente.
 */

import { normalizeHeader } from "@/lib/parse-spreadsheet";
import { brazilianMobileVariants, resolveContactPhones } from "@/lib/phone-normalize";

export type ContactImportField = "name" | "jobTitle" | "email" | "phone" | "whatsapp" | "source" | "company" | "tags" | "responsavel";

const FIELD_META: Record<ContactImportField, { candidates: string[]; required: boolean; label: string }> = {
  name: { required: true, label: "Nome", candidates: ["nome", "name", "nome completo"] },
  // Obrigatório mesmo padrão do cadastro manual (ver POST /api/contacts) —
  // usado em variável de personalização de campanha de WhatsApp.
  jobTitle: { required: true, label: "Cargo", candidates: ["cargo", "jobtitle", "job title", "funcao", "função"] },
  email: { required: false, label: "E-mail", candidates: ["email", "e-mail"] },
  phone: {
    required: false,
    label: "Celular",
    candidates: ["telefone", "celular", "phone", "fone", "celular 2", "celular2", "telefone 2", "telefone2", "segundo celular", "segundo telefone"],
  },
  whatsapp: { required: false, label: "WhatsApp", candidates: ["whatsapp", "whats"] },
  source: { required: false, label: "Origem", candidates: ["origem", "source"] },
  company: { required: false, label: "Empresa", candidates: ["empresa", "company"] },
  tags: { required: false, label: "Tags", candidates: ["tags", "etiquetas"] },
  // Relatado com print da prévia: "ele não mostra o responsável" — faltava
  // por completo (nem coluna reconhecida, nem no mapeamento manual). Nome OU
  // e-mail do consultor (mesma resolução de lib/deals/import-resolve.ts) —
  // não encontrado não bloqueia a linha, só fica sem responsável (igual ao
  // cadastro manual, onde "Ninguém" é um estado válido).
  responsavel: { required: false, label: "Responsável", candidates: ["responsavel", "responsável", "vendedor", "consultor", "owner"] },
};

export const IMPORT_FIELDS = Object.keys(FIELD_META) as ContactImportField[];

export type ColumnDetection = {
  field: ContactImportField;
  label: string;
  required: boolean;
  /** índice na linha de cabeçalho ORIGINAL (não normalizada) do arquivo — -1 = não encontrada. */
  index: number;
  /** Texto do cabeçalho como veio no arquivo, só pra exibir "achei 'Fone' pra Celular" na prévia. */
  headerLabel: string | null;
};

/**
 * Acha a coluna de cada campo — `overrides` (índice 0-based na linha de
 * cabeçalho) tem prioridade sobre a detecção automática por sinônimo, é como
 * o usuário corrige na tela de prévia quando o cabeçalho do arquivo dele não
 * bate com nenhum sinônimo conhecido.
 *
 * Chave AUSENTE em `overrides` = deixa a detecção automática decidir.
 * Chave PRESENTE (mesmo com valor -1) = vontade explícita do usuário, nunca
 * cai pra detecção automática — é assim que "Não usar" funciona pra campo
 * opcional (ver updateOverride em contact-import-dialog.tsx): sem essa
 * distinção, mandar -1 (índice "nenhuma coluna") caía neste `?? auto-detect`
 * e reimportava sozinho a MESMA coluna que a pessoa acabou de tirar.
 */
export function detectColumns(rawHeaderRow: string[], overrides?: Partial<Record<ContactImportField, number>>): ColumnDetection[] {
  const normalizedHeaderRow = rawHeaderRow.map(normalizeHeader);
  return IMPORT_FIELDS.map((field) => {
    const meta = FIELD_META[field];
    const overrideIndex = overrides?.[field];
    const index =
      overrideIndex !== undefined
        ? (overrideIndex >= 0 && overrideIndex < rawHeaderRow.length ? overrideIndex : -1)
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

export type RowIssueCode = "NO_NAME" | "NO_JOB_TITLE" | "DUPLICATE_CONTACT" | "OWNER_NOT_FOUND" | "INVALID_WHATSAPP" | "INVALID_PHONE";

/** Contato JÁ existente que colidiu com esta linha (telefone OU WhatsApp já
 * cadastrado) — presente só quando o issue é DUPLICATE_CONTACT contra um
 * contato de VERDADE no banco (nunca preenchido quando a colisão é com
 * outra linha do MESMO arquivo, que não tem dono nenhum pra pedir/assumir
 * ainda). Alimenta o "quem é o dono desse lead" na prévia (ver
 * contact-import-dialog.tsx) — pedido explícito: mostrar de quem é cada
 * linha ignorada, com ação de assumir (dono inativo) ou pedir (dono ativo). */
export type ExistingContactMatch = {
  id: string;
  name: string;
  responsavelId: string | null;
  responsavelName: string | null;
  /** false também quando não tem responsável nenhum — nesse caso não tem
   * "consultor pra pedir", é o mesmo caminho de "assumir direto" do dono
   * inativo (ver EditContactDialog/ContactConflictNotice, mesmo padrão). */
  responsavelActive: boolean;
  /** Campos que a planilha (ou um default de fieldDefaults) traz DIFERENTE
   * do que já está salvo neste contato — pedido explícito do usuário:
   * mostrar o que mudou numa linha duplicada, com opção de atualizar em
   * vez de só pular. Nunca inclui telefone/WhatsApp (é a própria CHAVE da
   * duplicidade, nunca diverge no sentido que importa aqui) nem
   * responsável (tem o próprio fluxo de Assumir/Solicitar, já é outra
   * decisão). Vazio = nada divergente, não precisa oferecer "Atualizar". */
  divergentFields: { field: "jobTitle" | "source" | "company" | "email"; label: string; oldValue: string | null; newValue: string }[];
};

export type ResolvedRow = {
  /** 1-based, contando a linha de cabeçalho como 1 — bate com o número de linha que a pessoa vê ao abrir a planilha. */
  rowNumber: number;
  willImport: boolean;
  name: string | null;
  jobTitle: string | null;
  source: string | null;
  responsavelName: string | null;
  issues: { code: RowIssueCode; message: string }[];
  existingContact?: ExistingContactMatch | null;
};

export type ImportPlanSummary = {
  totalRows: number;
  toCreate: number;
  skippedNoName: number;
  skippedNoJobTitle: number;
  /** Linhas ignoradas porque o Celular/WhatsApp veio preenchido mas inválido (ver resolveContactPhones). */
  skippedInvalidPhone: number;
  duplicateContacts: number;
  ownerFallbacks: number;
};

export type NewContactWrite = {
  name: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  source?: string;
  company?: string;
  jobTitle: string;
  tags: string[];
  responsavelId?: string;
  phoneNormalized: string | null;
  whatsappNormalized: string | null;
};

export type MemberInput = { userId: string; name: string; email: string };

export type ImportPlan = {
  columns: ColumnDetection[];
  missingRequiredColumns: ColumnDetection[];
  summary: ImportPlanSummary;
  rows: ResolvedRow[];
  /** Preenchido só na resolução de commit (includeWrites:true) — ausente na prévia. */
  writes?: { newContacts: NewContactWrite[] };
};

export type ExistingContactInput = {
  id: string;
  name: string;
  phoneNormalized: string | null;
  whatsappNormalized: string | null;
  responsavelId: string | null;
  responsavelName: string | null;
  responsavelActive: boolean;
  /** Só pra montar divergentFields (ver ExistingContactMatch) — nunca usado pra decidir duplicidade (isso é só phoneNormalized/whatsappNormalized). */
  jobTitle: string | null;
  source: string | null;
  company: string | null;
  email: string | null;
};

const DIVERGENT_FIELD_LABELS = { jobTitle: "Cargo", source: "Origem", company: "Empresa", email: "E-mail" } as const;

/**
 * Compara o que a linha resolveu (já com default aplicado, se houver) contra
 * o que já está salvo no contato existente — só entra na lista quando a
 * linha trouxe um valor NÃO VAZIO e ele é DIFERENTE do salvo (célula vazia
 * na planilha nunca "apaga" o que já existe, mesmo espírito de todo campo
 * opcional no cadastro manual). Comparação por texto exato após trim — um
 * espaço a mais/menos ou capitalização diferente já conta como divergente
 * de propósito: mostrar de mais (a pessoa decide ignorar clicando fora) é
 * bem menos arriscado que esconder uma divergência real.
 */
function buildDivergentFields(
  existing: ExistingContactInput,
  resolved: { jobTitle: string; source: string | undefined; company: string | undefined; email: string | undefined },
): ExistingContactMatch["divergentFields"] {
  const candidates: { field: keyof typeof DIVERGENT_FIELD_LABELS; oldValue: string | null; newValue: string | undefined }[] = [
    { field: "jobTitle", oldValue: existing.jobTitle, newValue: resolved.jobTitle },
    { field: "source", oldValue: existing.source, newValue: resolved.source },
    { field: "company", oldValue: existing.company, newValue: resolved.company },
    { field: "email", oldValue: existing.email, newValue: resolved.email },
  ];
  return candidates
    .filter((c): c is typeof c & { newValue: string } => !!c.newValue && c.newValue.trim() !== (c.oldValue ?? "").trim())
    .map((c) => ({ field: c.field, label: DIVERGENT_FIELD_LABELS[c.field], oldValue: c.oldValue, newValue: c.newValue }));
}

export type ResolveImportInput = {
  dataRows: string[][];
  rawHeaderRow: string[];
  columnOverrides?: Partial<Record<ContactImportField, number>>;
  /** Todo contato já cadastrado na organização com telefone OU whatsapp preenchido — usado só pra detectar colisão com a constraint única do banco (ver DUPLICATE_CONTACT), nunca pra decidir "atualizar" nada. */
  existingContacts: ExistingContactInput[];
  members: MemberInput[];
  /**
   * Valor único aplicado em toda linha cuja célula do campo correspondente
   * veio vazia — mesma ideia de fieldDefaults em lib/deals/import-resolve.ts.
   * `responsavel` ausente/vazio = fica sem responsável (comportamento de
   * sempre). `jobTitle` é diferente: o campo é OBRIGATÓRIO (ver FIELD_META
   * acima) — com um default preenchido, deixa de ser bloqueante mesmo sem
   * NENHUMA coluna de cargo na planilha (ver missingRequiredColumns abaixo),
   * pedido explícito do usuário pra planilha que nunca teve essa coluna.
   */
  fieldDefaults?: { responsavel?: string; jobTitle?: string; source?: string };
  includeWrites: boolean;
};

/** Constrói o plano inteiro — mesma função pra prévia (includeWrites: false) e commit (includeWrites: true). */
export function resolveImportPlan(input: ResolveImportInput): ImportPlan {
  const columns = detectColumns(input.rawHeaderRow, input.columnOverrides);
  const byField = new Map(columns.map((c) => [c.field, c]));
  const defaultJobTitle = input.fieldDefaults?.jobTitle?.trim() || undefined;
  // Origem não é obrigatória — o default aqui só preenche quando a célula
  // (ou a coluna inteira) vier vazia, nunca bloqueia nada (ver "source" no
  // loop abaixo, mesmo `||` de sempre pra campo opcional).
  const defaultSource = input.fieldDefaults?.source?.trim() || undefined;
  // Cargo tem um default aplicável a toda a planilha (ver fieldDefaults) —
  // com ele preenchido, a coluna deixa de ser obrigatória DE VERDADE: toda
  // linha sem a própria célula cai pro default (ver `jobTitle` no loop
  // abaixo), nunca fica sem cargo só por falta de COLUNA — só planilha E
  // default os dois vazios ainda bloqueiam/pulam a linha.
  const missingRequiredColumns = columns.filter(
    (c) => c.required && c.index === -1 && !(c.field === "jobTitle" && defaultJobTitle),
  );

  const cell = (row: string[], field: ContactImportField) => {
    const idx = byField.get(field)!.index;
    return idx === -1 ? "" : (row[idx] ?? "").trim();
  };

  // Contact tem @@unique([organizationId, phoneNormalized]) E
  // @@unique([organizationId, whatsappNormalized]) (ver schema.prisma) — uma
  // linha nova colide se QUALQUER um dos dois já estiver em uso, seja por um
  // contato já existente no banco, seja por uma linha ANTERIOR deste mesmo
  // arquivo (evita depender só de `skipDuplicates` no banco pra explicar por
  // que uma linha não virou contato). Por variante (9º dígito) — mesmo
  // motivo de sempre em phone-normalize.ts: planilha com número num formato
  // diferente do já salvo ainda precisa reconhecer a mesma pessoa.
  // Valor "in-file" = reivindicado por uma linha ANTERIOR deste mesmo
  // arquivo (nunca um contato de verdade, então nunca tem dono pra
  // pedir/assumir — ver ExistingContactMatch). Um ExistingContactInput real
  // preenche com os dados do contato já cadastrado.
  const claimed = new Map<string, ExistingContactInput | "in-file">();
  function claim(normalized: string | null, owner: ExistingContactInput | "in-file") {
    if (!normalized) return;
    for (const v of brazilianMobileVariants(normalized)) {
      if (!claimed.has(v)) claimed.set(v, owner);
    }
  }
  function findClaim(normalized: string | null): ExistingContactInput | "in-file" | null {
    if (!normalized) return null;
    for (const v of brazilianMobileVariants(normalized)) {
      const found = claimed.get(v);
      if (found) return found;
    }
    return null;
  }
  for (const c of input.existingContacts) {
    claim(c.phoneNormalized, c);
    claim(c.whatsappNormalized, c);
  }

  const memberByName = new Map(input.members.map((m) => [normalizeHeader(m.name), m.userId]));
  const memberByEmail = new Map(input.members.map((m) => [m.email.toLowerCase(), m.userId]));
  const memberNameById = new Map(input.members.map((m) => [m.userId, m.name]));
  const defaultResponsavelId =
    input.fieldDefaults?.responsavel && input.members.some((m) => m.userId === input.fieldDefaults!.responsavel)
      ? input.fieldDefaults.responsavel
      : undefined;

  const newContacts: NewContactWrite[] = [];
  const rows: ResolvedRow[] = [];

  let toCreate = 0;
  let skippedNoName = 0;
  let skippedNoJobTitle = 0;
  let skippedInvalidPhone = 0;
  let duplicateContacts = 0;
  let ownerFallbacks = 0;

  for (let i = 0; i < input.dataRows.length; i++) {
    const row = input.dataRows[i];
    const rowNumber = i + 2; // +1 pelo cabeçalho, +1 porque rowNumber é 1-based
    const issues: ResolvedRow["issues"] = [];

    const name = cell(row, "name");
    if (!name) {
      skippedNoName += 1;
      issues.push({ code: "NO_NAME", message: "Sem nome — linha ignorada" });
      rows.push({ rowNumber, willImport: false, name: null, jobTitle: null, source: null, responsavelName: null, issues });
      continue;
    }

    const jobTitle = cell(row, "jobTitle") || defaultJobTitle;
    const source = cell(row, "source") || defaultSource;
    if (!jobTitle) {
      skippedNoJobTitle += 1;
      issues.push({ code: "NO_JOB_TITLE", message: "Sem cargo — linha ignorada (cargo é obrigatório)" });
      rows.push({ rowNumber, willImport: false, name, jobTitle: null, source: source ?? null, responsavelName: null, issues });
      continue;
    }

    // Limpa/valida/formata Celular e WhatsApp num lugar só (ver
    // resolveContactPhones em lib/phone-normalize.ts): tira apóstrofo/aspas,
    // exige DDD/DDI válidos, aplica a máscara e o 9º dígito, move celular pro
    // WhatsApp vazio. Número preenchido mas INVÁLIDO barra a linha (não
    // importa lixo) — a prévia e a planilha de erros dizem qual e por quê,
    // pra corrigir e subir só essas de novo.
    const phones = resolveContactPhones({ phone: cell(row, "phone") || null, whatsapp: cell(row, "whatsapp") || null });
    if (phones.issues.length > 0) {
      skippedInvalidPhone += 1;
      for (const issue of phones.issues) {
        issues.push({
          code: issue.field === "whatsapp" ? "INVALID_WHATSAPP" : "INVALID_PHONE",
          message: `${issue.field === "whatsapp" ? "WhatsApp" : "Celular"} "${issue.raw}" — ${issue.message}`,
        });
      }
      rows.push({ rowNumber, willImport: false, name, jobTitle, source: source ?? null, responsavelName: null, issues });
      continue;
    }
    const { phone, whatsapp, phoneNormalized, whatsappNormalized } = phones;
    // Resolvidos aqui (não só lá embaixo, na hora de criar) — o ramo de
    // duplicidade logo abaixo também precisa deles pra montar
    // divergentFields (ver ExistingContactMatch).
    const email = cell(row, "email") || undefined;
    const company = cell(row, "company") || undefined;

    const claimant = findClaim(phoneNormalized) ?? findClaim(whatsappNormalized);
    if (claimant) {
      duplicateContacts += 1;
      issues.push({ code: "DUPLICATE_CONTACT", message: "Já existe contato com esse telefone ou WhatsApp — linha ignorada" });
      const existingContact: ExistingContactMatch | null =
        claimant === "in-file"
          ? null
          : {
              id: claimant.id,
              name: claimant.name,
              responsavelId: claimant.responsavelId,
              responsavelName: claimant.responsavelName,
              responsavelActive: claimant.responsavelActive,
              divergentFields: buildDivergentFields(claimant, { jobTitle, source, company, email }),
            };
      rows.push({ rowNumber, willImport: false, name, jobTitle, source: source ?? null, responsavelName: null, issues, existingContact });
      continue;
    }
    claim(phoneNormalized, "in-file");
    claim(whatsappNormalized, "in-file");

    const responsavelRaw = cell(row, "responsavel");
    let responsavelId = responsavelRaw ? (memberByEmail.get(responsavelRaw.toLowerCase()) ?? memberByName.get(normalizeHeader(responsavelRaw))) : undefined;
    if (!responsavelId && responsavelRaw) {
      ownerFallbacks += 1;
      issues.push({ code: "OWNER_NOT_FOUND", message: `Responsável "${responsavelRaw}" não encontrado — contato ficou sem responsável` });
    }
    if (!responsavelId) responsavelId = defaultResponsavelId;
    const responsavelName = responsavelId ? (memberNameById.get(responsavelId) ?? null) : null;

    const tagsRaw = cell(row, "tags");
    const tags = tagsRaw
      ? tagsRaw
          .split(/[,;]/)
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    toCreate += 1;
    rows.push({ rowNumber, willImport: true, name, jobTitle, source: source ?? null, responsavelName, issues });
    if (input.includeWrites) {
      newContacts.push({
        name,
        email,
        phone: phone ?? undefined,
        whatsapp: whatsapp ?? undefined,
        source,
        company,
        jobTitle,
        tags,
        responsavelId,
        phoneNormalized,
        whatsappNormalized,
      });
    }
  }

  const summary: ImportPlanSummary = {
    totalRows: input.dataRows.length,
    toCreate,
    skippedNoName,
    skippedNoJobTitle,
    skippedInvalidPhone,
    ownerFallbacks,
    duplicateContacts,
  };

  return {
    columns,
    missingRequiredColumns,
    summary,
    rows,
    writes: input.includeWrites ? { newContacts } : undefined,
  };
}
