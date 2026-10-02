/**
 * Motor de resolução da importação de contatos — mesmo espírito de
 * lib/deals/import-resolve.ts (puro, sem escrita no banco), usado tanto pela
 * prévia (POST /api/contacts/import/preview) quanto pelo commit de verdade
 * (POST /api/contacts/import) — as duas rotas chamam exatamente esta mesma
 * função, então o que a prévia mostra é garantidamente o mesmo cálculo que
 * vai gravar.
 *
 * Mais simples que o de negócios de propósito: contato não tem etapa nem
 * "já tem X aberto" pra resolver — só nome/cargo obrigatórios e a mesma
 * constraint única do banco (telefone OU whatsapp) que decide se uma linha
 * colide com um contato já existente.
 */

import { normalizeHeader } from "@/lib/parse-spreadsheet";
import { brazilianMobileVariants, resolveContactPhones } from "@/lib/phone-normalize";
import { ESTADOS_BR } from "@/lib/contacts/constants";
import { formatCep } from "@/lib/cep";
import { MAPPING_NONE, MAPPING_SKIP } from "@/lib/contacts/import-mapping";

export type ContactImportField =
  | "name"
  | "jobTitle"
  | "email"
  | "phone"
  | "whatsapp"
  | "source"
  | "company"
  | "tags"
  | "responsavel"
  | "zipCode"
  | "address"
  | "addressNumber"
  | "addressComplement"
  | "neighborhood"
  | "city"
  | "state";

/** Os 7 campos de endereço, na ordem em que aparecem no cadastro manual. */
export type AddressField = "zipCode" | "address" | "addressNumber" | "addressComplement" | "neighborhood" | "city" | "state";
export const ADDRESS_FIELDS: AddressField[] = ["zipCode", "address", "addressNumber", "addressComplement", "neighborhood", "city", "state"];

const FIELD_META: Record<ContactImportField, { candidates: string[]; required: boolean; label: string }> = {
  name: { required: true, label: "Nome", candidates: ["nome", "name", "nome completo"] },
  // Obrigatório POR CONTATO, mesmo padrão do cadastro manual (ver POST
  // /api/contacts) — mas não como COLUNA: planilha sem coluna de cargo vira
  // a decisão "N linhas sem cargo" na revisão (ver PendingValue), em vez de
  // travar a tela de colunas.
  jobTitle: { required: false, label: "Cargo", candidates: ["cargo", "jobtitle", "job title", "funcao", "função"] },
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
  // Endereço — relatado: "eu tenho UF e Cidade também, mas o sistema não
  // aceita". Mesmos 7 campos do cadastro manual (ver Contact no schema). O
  // primeiro candidato de cada um é o cabeçalho da planilha modelo (ver
  // lib/contact-import-template.ts).
  zipCode: { required: false, label: "CEP", candidates: ["cep", "codigo postal", "zip", "zipcode"] },
  address: { required: false, label: "Rua", candidates: ["rua", "endereco", "logradouro", "address", "avenida"] },
  addressNumber: { required: false, label: "Número", candidates: ["numero", "num", "nº", "n°", "nro", "numero endereco"] },
  addressComplement: { required: false, label: "Complemento", candidates: ["complemento", "compl", "compl."] },
  neighborhood: { required: false, label: "Bairro", candidates: ["bairro"] },
  city: { required: false, label: "Cidade", candidates: ["cidade", "municipio", "city"] },
  state: { required: false, label: "UF", candidates: ["uf", "estado", "state"] },
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

export type RowIssueCode =
  | "NO_NAME"
  | "NO_JOB_TITLE"
  | "DUPLICATE_CONTACT"
  | "OWNER_NOT_FOUND"
  | "INVALID_WHATSAPP"
  | "INVALID_PHONE"
  | "INVALID_STATE"
  | "INVALID_ZIP"
  | "UNKNOWN_SOURCE";

const STATE_BY_KEY = new Map<string, string>();
for (const uf of ESTADOS_BR) {
  STATE_BY_KEY.set(uf.value.toLowerCase(), uf.value);
  STATE_BY_KEY.set(normalizeHeader(uf.label), uf.value);
}

/** "ms", "MS", "Mato Grosso do Sul", "mato grosso do sul" → "MS". Qualquer outra coisa → null. */
export function normalizeState(raw: string): string | null {
  return STATE_BY_KEY.get(normalizeHeader(raw).replace(/\s+/g, " ")) ?? null;
}

/**
 * CEP com ou sem máscara/pontos → "79002-000". 7 dígitos = o Excel comeu o
 * zero da frente (CEP de SP/RJ começa com 0 e a célula virou número) — volta
 * o zero em vez de recusar. Qualquer outro tamanho → null.
 */
export function normalizeZipCode(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 7) return formatCep(`0${digits}`);
  if (digits.length === 8) return formatCep(digits);
  return null;
}

/**
 * "Campo Grande/MS", "Campo Grande - MS", "Campo Grande (MS)" → cidade e UF
 * separadas. Só usado quando a planilha NÃO trouxe a UF numa coluna própria
 * — com UF preenchida, a cidade fica exatamente como veio.
 */
function formatLocation(address: Partial<Record<AddressField, string>>): string | null {
  return [address.city, address.state].filter(Boolean).join(" - ") || null;
}

function splitCityState(raw: string): { city: string; state: string | null } {
  const match = raw.match(/^(.+?)\s*(?:\/|-|\(|,)\s*([A-Za-z]{2})\)?\s*$/);
  if (!match) return { city: raw, state: null };
  const state = normalizeState(match[2]);
  return state ? { city: match[1].trim(), state } : { city: raw, state: null };
}

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
  /** Campos que a planilha (já resolvidos contra o CRM) traz DIFERENTE
   * do que já está salvo neste contato — pedido explícito do usuário:
   * mostrar o que mudou numa linha duplicada, com opção de atualizar em
   * vez de só pular. Nunca inclui telefone/WhatsApp (é a própria CHAVE da
   * duplicidade, nunca diverge no sentido que importa aqui) nem
   * responsável (tem o próprio fluxo de Assumir/Solicitar, já é outra
   * decisão). Vazio = nada divergente, não precisa oferecer "Atualizar". */
  divergentFields: { field: DivergentField; label: string; oldValue: string | null; newValue: string }[];
};

export type DivergentField = "jobTitle" | "source" | "company" | "email" | AddressField;

export type ResolvedRow = {
  /** 1-based, contando a linha de cabeçalho como 1 — bate com o número de linha que a pessoa vê ao abrir a planilha. */
  rowNumber: number;
  willImport: boolean;
  name: string | null;
  /** Já no rótulo do CRM ("produtor rural" na planilha → "Produtor Rural"). null = vazio ou esperando decisão. */
  jobTitle: string | null;
  source: string | null;
  /** Pra quem esta linha vai. Preenchido TAMBÉM nas linhas duplicadas: é
   * quem deve receber o lead ao clicar "Atribuir"/"Pedir" na prévia
   * (relatado: o dono importando pro Vinicius clicou "Atribuir" e o lead foi
   * pro próprio dono, porque a tela não sabia pra quem cada linha era). */
  responsavelId: string | null;
  responsavelName: string | null;
  /** "Dourados - MS" — só pra prévia mostrar que o endereço foi lido. */
  location: string | null;
  /** Chave da decisão pendente (ver PendingValue) de cada campo que não
   * bateu com o CRM — a tela aplica a escolha da pessoa na hora, sem
   * precisar analisar a planilha de novo. */
  pending?: Partial<Record<DecisionField, string>>;
  issues: { code: RowIssueCode; message: string }[];
  existingContact?: ExistingContactMatch | null;
};

export type ImportPlanSummary = {
  totalRows: number;
  toCreate: number;
  skippedNoName: number;
  /** Sem cargo que exista no CRM (nem escolhido na revisão) ou "não importar" escolhido. */
  skippedNoJobTitle: number;
  /** Linhas ignoradas porque o Celular/WhatsApp veio preenchido mas inválido (ver resolveContactPhones). */
  skippedInvalidPhone: number;
  duplicateContacts: number;
  /** Responsável da planilha que não bateu com ninguém e ficou sem decisão — contato entra sem responsável. */
  ownerFallbacks: number;
  /** UF ou CEP que não deu pra entender — o contato entra mesmo assim, só sem esse campo. */
  addressWarnings: number;
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
} & Partial<Record<AddressField, string>>;

export type MemberInput = { userId: string; name: string; email: string };

/** Campos cujo valor da planilha precisa existir no CRM (Configurações → Cargos/Origens, e a equipe). */
export type DecisionField = "jobTitle" | "source" | "responsavel";

export { MAPPING_NONE, MAPPING_SKIP };

/**
 * Escolha da pessoa pra cada valor que não bateu: campo → chave (ver
 * PendingValue.key) → rótulo do CRM / userId / MAPPING_SKIP / MAPPING_NONE.
 * Só a importação de verdade recebe isto — a prévia devolve os valores
 * pendentes crus e a tela aplica as escolhas sozinha (sem gastar uma nova
 * análise da planilha a cada clique).
 */
export type ValueMappings = Partial<Record<DecisionField, Record<string, string>>>;

/** JSON vindo do navegador → ValueMappings, ou null se o formato não bate (só strings, só os 3 campos). */
export function parseValueMappings(raw: string): ValueMappings | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out: ValueMappings = {};
  for (const [field, map] of Object.entries(parsed)) {
    if (field !== "jobTitle" && field !== "source" && field !== "responsavel") return null;
    if (!map || typeof map !== "object" || Array.isArray(map)) return null;
    const entries = Object.entries(map);
    if (entries.some(([, v]) => typeof v !== "string")) return null;
    out[field] = Object.fromEntries(entries) as Record<string, string>;
  }
  return out;
}

/**
 * Um valor da planilha que não existe no CRM (ou célula vazia de campo que
 * pede decisão) — agrupado: 300 linhas com "Fazendeiro" são UMA pergunta.
 * Pedido explícito: "o próprio sistema deve entender se está vazia ou não e
 * saber se aquele usuário, origem e cargo existem dentro do CRM" — então só
 * vira pergunta o que de fato não bate, nunca um formulário de "valor
 * padrão" pra planilha que já veio completa.
 */
export type PendingValue = {
  field: DecisionField;
  /** valueKey do texto da planilha; "" = célula vazia (ou coluna que nem existe). */
  key: string;
  /** Como veio na planilha (1ª ocorrência); "" pra célula vazia. */
  raw: string;
  /** Linhas que viram contato novo e dependem desta resposta. */
  rows: number;
  /** Linhas que já existem no CRM com este valor — só pesam no "Iria para" dos duplicados. */
  duplicateRows: number;
  /** Sem resposta, a importação não segue (cargo é obrigatório; um nome/origem da planilha nunca some calado). */
  blocking: boolean;
  /** Palpite (rótulo do CRM ou userId) quando há UM candidato óbvio — vem já escolhido na tela, à vista. */
  suggestion: string | null;
  /** Responsável que existe na equipe mas está inativo. */
  inactiveMember?: boolean;
};

export type ImportPlan = {
  columns: ColumnDetection[];
  missingRequiredColumns: ColumnDetection[];
  summary: ImportPlanSummary;
  rows: ResolvedRow[];
  pendingValues: PendingValue[];
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
} & Record<AddressField, string | null>;

const DIVERGENT_FIELD_LABELS: Record<DivergentField, string> = {
  jobTitle: "Cargo",
  source: "Origem",
  company: "Empresa",
  email: "E-mail",
  zipCode: "CEP",
  address: "Rua",
  addressNumber: "Número",
  addressComplement: "Complemento",
  neighborhood: "Bairro",
  city: "Cidade",
  state: "UF",
};

/**
 * Compara o que a linha resolveu contra o que já está salvo no contato
 * existente — só entra na lista quando a linha trouxe um valor NÃO VAZIO e
 * ele é DIFERENTE do salvo (célula vazia na planilha nunca "apaga" o que já
 * existe, mesmo espírito de todo campo opcional no cadastro manual).
 * Comparação por texto exato após trim — mostrar de mais (a pessoa decide
 * não atualizar) é bem menos arriscado que esconder uma divergência real.
 */
function buildDivergentFields(
  existing: ExistingContactInput,
  resolved: Partial<Record<DivergentField, string>>,
): ExistingContactMatch["divergentFields"] {
  const candidates = (Object.keys(DIVERGENT_FIELD_LABELS) as DivergentField[]).map((field) => ({
    field,
    oldValue: existing[field],
    newValue: resolved[field],
  }));
  return candidates
    .filter((c): c is typeof c & { newValue: string } => !!c.newValue && c.newValue.trim() !== (c.oldValue ?? "").trim())
    .map((c) => ({ field: c.field, label: DIVERGENT_FIELD_LABELS[c.field], oldValue: c.oldValue, newValue: c.newValue }));
}

/** Sem acento, minúsculo, espaços colapsados — "  Produtor  RURAL" e "produtor rural" são o mesmo valor. */
export function valueKey(raw: string): string {
  return normalizeHeader(raw).replace(/\s+/g, " ");
}

/** Lista fechada do CRM (Cargos/Origens): acha o rótulo exato e, sem exato, um palpite único. */
function makeCatalog(labels: string[]) {
  const byKey = new Map(labels.map((l) => [valueKey(l), l]));
  return {
    has: (label: string) => byKey.get(valueKey(label)) === label,
    exact: (raw: string) => byKey.get(valueKey(raw)) ?? null,
    // "Produtor" → "Produtor Rural", "Insta" → "Instagram" — só quando UM
    // rótulo contém o texto (ou vice-versa). Dois candidatos = sem palpite.
    suggest: (raw: string) => {
      const k = valueKey(raw);
      if (k.length < 3) return null;
      const hits = labels.filter((l) => {
        const lk = valueKey(l);
        return lk.includes(k) || k.includes(lk);
      });
      return hits.length === 1 ? hits[0] : null;
    },
  };
}

/** Equipe: e-mail ou nome exato resolvem direto; "Vinicius" sozinho vira palpite se só um Vinicius existir. */
function makeMemberMatcher(members: MemberInput[], inactiveMembers: Omit<MemberInput, "userId">[]) {
  const byName = new Map(members.map((m) => [valueKey(m.name), m.userId]));
  const byEmail = new Map(members.map((m) => [m.email.toLowerCase(), m.userId]));
  const ids = new Set(members.map((m) => m.userId));
  const inactive = new Set(inactiveMembers.flatMap((m) => [valueKey(m.name), m.email.toLowerCase()]));
  return {
    has: (userId: string) => ids.has(userId),
    exact: (raw: string) => byEmail.get(raw.toLowerCase()) ?? byName.get(valueKey(raw)) ?? null,
    isInactive: (raw: string) => inactive.has(valueKey(raw)) || inactive.has(raw.toLowerCase()),
    suggest: (raw: string) => {
      const tokens = valueKey(raw).split(" ").filter((t) => t.length >= 2);
      if (tokens.length === 0) return null;
      const hits = members.filter((m) => {
        const memberTokens = valueKey(m.name).split(" ");
        return tokens.every((t) => memberTokens.includes(t));
      });
      return hits.length === 1 ? hits[0].userId : null;
    },
  };
}

export type ResolveImportInput = {
  dataRows: string[][];
  rawHeaderRow: string[];
  columnOverrides?: Partial<Record<ContactImportField, number>>;
  /** Todo contato já cadastrado na organização com telefone OU whatsapp preenchido — usado só pra detectar colisão com a constraint única do banco (ver DUPLICATE_CONTACT), nunca pra decidir "atualizar" nada. */
  existingContacts: ExistingContactInput[];
  /** Equipe ATIVA — quem pode receber contato. */
  members: MemberInput[];
  /** Só pra dizer "está inativo" em vez de "não encontrado". */
  inactiveMembers?: Omit<MemberInput, "userId">[];
  /** Configurações → Cargos (rótulos). */
  jobTitleOptions: string[];
  /** Configurações → Origens (rótulos). */
  sourceOptions: string[];
  valueMappings?: ValueMappings;
  includeWrites: boolean;
};

/** Constrói o plano inteiro — mesma função pra prévia (includeWrites: false) e commit (includeWrites: true). */
export function resolveImportPlan(input: ResolveImportInput): ImportPlan {
  const columns = detectColumns(input.rawHeaderRow, input.columnOverrides);
  const byField = new Map(columns.map((c) => [c.field, c]));
  const missingRequiredColumns = columns.filter((c) => c.required && c.index === -1);

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

  const jobTitles = makeCatalog(input.jobTitleOptions);
  const sources = makeCatalog(input.sourceOptions);
  const team = makeMemberMatcher(input.members, input.inactiveMembers ?? []);
  const memberNameById = new Map(input.members.map((m) => [m.userId, m.name]));
  const mappings = input.valueMappings ?? {};

  const pendingByKey = new Map<string, PendingValue>();
  function pendingFor(field: DecisionField, raw: string, blocking: boolean, suggest: () => string | null, inactiveMember?: boolean) {
    const key = raw ? valueKey(raw) : "";
    const id = `${field}:${key}`;
    let p = pendingByKey.get(id);
    if (!p) {
      p = { field, key, raw, rows: 0, duplicateRows: 0, blocking, suggestion: raw ? suggest() : null, ...(inactiveMember ? { inactiveMember } : {}) };
      pendingByKey.set(id, p);
    }
    return p;
  }

  /**
   * Resultado de um campo de lista fechada numa linha: valor final, ou a
   * decisão pendente que ele espera. A escolha mandada em valueMappings só é
   * aceita se for um valor que EXISTE no CRM (nunca grava texto arbitrário
   * vindo do navegador como cargo/origem/responsável).
   */
  type Decided = { value: string | undefined; pending: PendingValue | null; skip?: boolean };

  function decideJobTitle(raw: string): Decided {
    const exact = raw ? jobTitles.exact(raw) : null;
    if (exact) return { value: exact, pending: null };
    const p = pendingFor("jobTitle", raw, true, () => jobTitles.suggest(raw));
    const choice = mappings.jobTitle?.[p.key];
    if (choice === MAPPING_SKIP) return { value: undefined, pending: p, skip: true };
    if (choice && jobTitles.has(choice)) return { value: choice, pending: p };
    return { value: undefined, pending: p };
  }

  function decideSource(raw: string): Decided {
    if (!raw) return { value: undefined, pending: null };
    const exact = sources.exact(raw);
    if (exact) return { value: exact, pending: null };
    const p = pendingFor("source", raw, true, () => sources.suggest(raw));
    const choice = mappings.source?.[p.key];
    if (choice && choice !== MAPPING_NONE && sources.has(choice)) return { value: choice, pending: p };
    return { value: undefined, pending: p };
  }

  function decideResponsavel(raw: string): Decided {
    const exact = raw ? team.exact(raw) : null;
    if (exact) return { value: exact, pending: null };
    // Célula vazia também vira pergunta, mas não bloqueia: "N linhas sem
    // responsável → Ninguém" (padrão) — é justamente a planilha sem coluna
    // de responsável importada POR OUTRA PESSOA que precisa dessa pergunta.
    const p = pendingFor("responsavel", raw, !!raw, () => team.suggest(raw), raw ? team.isInactive(raw) : undefined);
    const choice = mappings.responsavel?.[p.key];
    if (choice && choice !== MAPPING_NONE && team.has(choice)) return { value: choice, pending: p };
    return { value: undefined, pending: p };
  }

  const newContacts: NewContactWrite[] = [];
  const rows: ResolvedRow[] = [];

  let toCreate = 0;
  let skippedNoName = 0;
  let skippedNoJobTitle = 0;
  let skippedInvalidPhone = 0;
  let duplicateContacts = 0;
  let ownerFallbacks = 0;
  let addressWarnings = 0;

  for (let i = 0; i < input.dataRows.length; i++) {
    const row = input.dataRows[i];
    const rowNumber = i + 2; // +1 pelo cabeçalho, +1 porque rowNumber é 1-based
    const issues: ResolvedRow["issues"] = [];
    const empty = { jobTitle: null, source: null, responsavelId: null, responsavelName: null, location: null };

    const name = cell(row, "name");
    if (!name) {
      skippedNoName += 1;
      issues.push({ code: "NO_NAME", message: "Sem nome — linha ignorada" });
      rows.push({ rowNumber, willImport: false, name: null, ...empty, issues });
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
      rows.push({ rowNumber, willImport: false, name, ...empty, issues });
      continue;
    }
    const { phone, whatsapp, phoneNormalized, whatsappNormalized } = phones;
    const email = cell(row, "email") || undefined;
    const company = cell(row, "company") || undefined;

    const jobTitleRaw = cell(row, "jobTitle");
    const sourceRaw = cell(row, "source");
    const responsavelRaw = cell(row, "responsavel");
    const jobTitle = decideJobTitle(jobTitleRaw);
    const source = decideSource(sourceRaw);
    const responsavel = decideResponsavel(responsavelRaw);
    const responsavelId = responsavel.value;
    const responsavelName = responsavelId ? (memberNameById.get(responsavelId) ?? null) : null;
    const pending: ResolvedRow["pending"] = {};
    if (jobTitle.pending) pending.jobTitle = jobTitle.pending.key;
    if (source.pending) pending.source = source.pending.key;
    if (responsavel.pending) pending.responsavel = responsavel.pending.key;
    const pendingOrUndefined = Object.keys(pending).length > 0 ? pending : undefined;

    const address: Partial<Record<AddressField, string>> = {};
    const addressIssues: ResolvedRow["issues"] = [];
    for (const field of ADDRESS_FIELDS) {
      const value = cell(row, field);
      if (value) address[field] = value;
    }
    if (address.state) {
      const state = normalizeState(address.state);
      if (state) address.state = state;
      else {
        addressIssues.push({ code: "INVALID_STATE", message: `UF "${address.state}" não reconhecida — contato entra sem UF` });
        delete address.state;
      }
    } else if (address.city) {
      const split = splitCityState(address.city);
      address.city = split.city;
      if (split.state) address.state = split.state;
    }
    if (address.zipCode) {
      const zip = normalizeZipCode(address.zipCode);
      if (zip) address.zipCode = zip;
      else {
        addressIssues.push({ code: "INVALID_ZIP", message: `CEP "${address.zipCode}" inválido — contato entra sem CEP` });
        delete address.zipCode;
      }
    }

    const resolvedRow = {
      rowNumber,
      name,
      jobTitle: jobTitle.value ?? null,
      source: source.value ?? null,
      responsavelId: responsavelId ?? null,
      responsavelName,
      location: formatLocation(address),
      pending: pendingOrUndefined,
    };

    const claimant = findClaim(phoneNormalized) ?? findClaim(whatsappNormalized);
    if (claimant) {
      duplicateContacts += 1;
      for (const d of [jobTitle, source, responsavel]) if (d.pending) d.pending.duplicateRows += 1;
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
              divergentFields: buildDivergentFields(claimant, { jobTitle: jobTitle.value, source: source.value, company, email, ...address }),
            };
      rows.push({ ...resolvedRow, willImport: false, issues, existingContact });
      continue;
    }
    // Reivindica o telefone mesmo se a linha ainda espera o cargo — senão a
    // prévia (sem a resposta) e a importação (com a resposta) discordariam
    // sobre uma linha MAIS ABAIXO com o mesmo número ser duplicada ou não.
    claim(phoneNormalized, "in-file");
    claim(whatsappNormalized, "in-file");
    for (const d of [jobTitle, source, responsavel]) if (d.pending) d.pending.rows += 1;

    if (!jobTitle.value) {
      skippedNoJobTitle += 1;
      issues.push({
        code: "NO_JOB_TITLE",
        message: jobTitle.skip
          ? "Linha ignorada (escolhido não importar)"
          : jobTitleRaw
            ? `Cargo "${jobTitleRaw}" não existe no CRM — linha ignorada`
            : "Sem cargo — linha ignorada (cargo é obrigatório)",
      });
      rows.push({ ...resolvedRow, willImport: false, issues });
      continue;
    }

    if (sourceRaw && !source.value && mappings.source?.[valueKey(sourceRaw)] !== MAPPING_NONE) {
      issues.push({ code: "UNKNOWN_SOURCE", message: `Origem "${sourceRaw}" não existe no CRM — contato entra sem origem` });
    }
    if (responsavelRaw && !responsavelId && mappings.responsavel?.[valueKey(responsavelRaw)] !== MAPPING_NONE) {
      ownerFallbacks += 1;
      issues.push({
        code: "OWNER_NOT_FOUND",
        message: team.isInactive(responsavelRaw)
          ? `Responsável "${responsavelRaw}" está inativo — contato ficou sem responsável`
          : `Responsável "${responsavelRaw}" não encontrado — contato ficou sem responsável`,
      });
    }
    if (addressIssues.length > 0) {
      addressWarnings += 1;
      issues.push(...addressIssues);
    }

    const tagsRaw = cell(row, "tags");
    const tags = tagsRaw
      ? tagsRaw
          .split(/[,;]/)
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    toCreate += 1;
    rows.push({ ...resolvedRow, willImport: true, issues });
    if (input.includeWrites) {
      newContacts.push({
        name,
        email,
        phone: phone ?? undefined,
        whatsapp: whatsapp ?? undefined,
        source: source.value,
        company,
        jobTitle: jobTitle.value,
        tags,
        responsavelId,
        phoneNormalized,
        whatsappNormalized,
        ...address,
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
    addressWarnings,
  };

  // Ordem da tela: o que bloqueia primeiro, depois o que tem mais linhas.
  const fieldOrder: Record<DecisionField, number> = { responsavel: 0, jobTitle: 1, source: 2 };
  const pendingValues = [...pendingByKey.values()]
    .filter((p) => p.rows > 0 || (p.field === "responsavel" && p.duplicateRows > 0))
    .sort((a, b) => fieldOrder[a.field] - fieldOrder[b.field] || Number(b.blocking) - Number(a.blocking) || b.rows - a.rows);

  return {
    columns,
    missingRequiredColumns,
    summary,
    rows,
    pendingValues,
    writes: input.includeWrites ? { newContacts } : undefined,
  };
}
