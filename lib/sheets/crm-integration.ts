import type { CellValue, SheetColumnType } from "@/lib/sheets/column-types";

export type CrmEntity = "contacts" | "deals";

export type CrmField = {
  key: string;
  label: string;
  type: SheetColumnType;
  writable: boolean;
  defaultPull?: boolean;
  config?: Record<string, unknown>;
  description?: string;
  customFieldId?: string;
};

export type CrmCustomFieldDefinition = {
  id: string;
  entityType: "CONTACT" | "DEAL";
  label: string;
  type: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT" | "CPF";
  options: string[];
  required: boolean;
};

export type CrmConnector = {
  entity: CrmEntity;
  label: string;
  singular: string;
  identity: CrmField;
  fields: readonly CrmField[];
  updatePath: (id: string) => string;
};

const CONTACT_FIELDS = [
  { key: "name", label: "Nome do cliente", type: "TEXT", writable: true, defaultPull: true },
  { key: "email", label: "E-mail", type: "EMAIL", writable: true, defaultPull: true },
  { key: "phone", label: "Celular", type: "PHONE", writable: true, defaultPull: true },
  { key: "whatsapp", label: "WhatsApp", type: "PHONE", writable: true },
  { key: "source", label: "Origem do cliente", type: "TEXT", writable: true, defaultPull: true },
  { key: "company", label: "Empresa", type: "TEXT", writable: true },
  { key: "jobTitle", label: "Cargo", type: "TEXT", writable: true },
  { key: "birthDate", label: "Nascimento", type: "DATE", writable: true },
  { key: "address", label: "Endereço", type: "TEXT", writable: true },
  { key: "addressNumber", label: "Número", type: "TEXT", writable: true },
  { key: "addressComplement", label: "Complemento", type: "TEXT", writable: true },
  { key: "neighborhood", label: "Bairro", type: "TEXT", writable: true },
  { key: "city", label: "Cidade", type: "TEXT", writable: true },
  { key: "state", label: "UF", type: "TEXT", writable: true },
  { key: "zipCode", label: "CEP", type: "TEXT", writable: true },
  { key: "tags", label: "Tags do cliente", type: "TEXT", writable: true },
  { key: "responsavelId", label: "Responsável pelo cliente", type: "USER", writable: true },
  { key: "needsEnrichment", label: "Cadastro precisa ser completado", type: "CHECKBOX", writable: false },
  { key: "leadQualification", label: "Qualificação do lead", type: "SELECT", writable: false, config: { options: ["Não avaliado", "Qualificado", "Não qualificado"] } },
  { key: "leadQualificationAt", label: "Data da qualificação", type: "DATE", writable: false },
  { key: "leadQualificationBy", label: "Qualificado por", type: "USER", writable: false },
  { key: "whatsappOptOut", label: "Não receber campanhas no WhatsApp", type: "CHECKBOX", writable: false },
  { key: "metaCampaignName", label: "Campanha da Meta", type: "TEXT", writable: false },
  { key: "metaCampaignId", label: "ID da campanha da Meta", type: "TEXT", writable: false },
  { key: "metaAdSetId", label: "ID do conjunto de anúncios", type: "TEXT", writable: false },
  { key: "metaAdId", label: "ID do anúncio", type: "TEXT", writable: false },
  { key: "metaFormId", label: "ID do formulário da Meta", type: "TEXT", writable: false },
  { key: "agendorContactId", label: "Código do cliente no Agendor", type: "TEXT", writable: false },
  { key: "createdAt", label: "Criado em", type: "DATE", writable: false },
  { key: "updatedAt", label: "Atualizado em", type: "DATE", writable: false },
] as const satisfies readonly CrmField[];

const DEAL_FIELDS = [
  { key: "name", label: "Nome do negócio", type: "TEXT", writable: true, defaultPull: true },
  { key: "contactId", label: "Cliente do negócio", type: "CONTACT", writable: false, defaultPull: true },
  { key: "ownerId", label: "Responsável pelo negócio", type: "USER", writable: true, defaultPull: true },
  // Só leitura: Ganho/Perdido têm fluxo próprio no CRM (motivo de perda, comissão, processo).
  {
    key: "status",
    label: "Status do negócio",
    type: "SELECT",
    writable: false,
    defaultPull: true,
    config: { options: ["Em andamento", "Ganho", "Perdido"] },
  },
  { key: "value", label: "Valor líquido", type: "CURRENCY", writable: true, defaultPull: true, config: { decimals: 2 } },
  { key: "grossValue", label: "Valor bruto", type: "CURRENCY", writable: true, config: { decimals: 2 } },
  { key: "creditType", label: "Categoria", type: "TEXT", writable: true },
  { key: "description", label: "Descrição", type: "LONG_TEXT", writable: true },
  { key: "expectedCloseAt", label: "Previsão de fechamento", type: "DATE", writable: true },
  { key: "pipelineName", label: "Funil", type: "TEXT", writable: false },
  { key: "stageName", label: "Etapa", type: "TEXT", writable: false, defaultPull: true },
  { key: "startedAt", label: "Data de início do negócio", type: "DATE", writable: false },
  { key: "stageEnteredAt", label: "Entrada na etapa atual", type: "DATE", writable: false },
  { key: "closedAt", label: "Data de fechamento", type: "DATE", writable: false },
  { key: "administratorName", label: "Administradora", type: "TEXT", writable: false },
  { key: "lossReasonName", label: "Motivo da perda", type: "TEXT", writable: false },
  { key: "lostReason", label: "Detalhes da perda", type: "LONG_TEXT", writable: false },
  { key: "participants", label: "Co-responsáveis", type: "TEXT", writable: false },
  { key: "agendorDealId", label: "Código do negócio no Agendor", type: "TEXT", writable: false },
  { key: "createdAt", label: "Criado em", type: "DATE", writable: false },
  { key: "updatedAt", label: "Atualizado em", type: "DATE", writable: false },
] as const satisfies readonly CrmField[];

export const CRM_CONNECTORS: Record<CrmEntity, CrmConnector> = {
  contacts: {
    entity: "contacts",
    label: "Clientes",
    singular: "Cliente",
    identity: { key: "__record", label: "Cliente", type: "CONTACT", writable: false, defaultPull: true },
    fields: CONTACT_FIELDS,
    updatePath: (id) => `/api/contacts/${encodeURIComponent(id)}`,
  },
  deals: {
    entity: "deals",
    label: "Negócios",
    singular: "Negócio",
    identity: { key: "__record", label: "Negócio", type: "DEAL", writable: false, defaultPull: true },
    fields: DEAL_FIELDS,
    updatePath: (id) => `/api/deals/${encodeURIComponent(id)}`,
  },
};

export function isCrmEntity(value: unknown): value is CrmEntity {
  return value === "contacts" || value === "deals";
}

export function crmField(connector: CrmConnector, key: string): CrmField | undefined {
  if (key === connector.identity.key) return connector.identity;
  return connector.fields.find((field) => field.key === key);
}

const CUSTOM_TYPE_TO_SHEET: Record<CrmCustomFieldDefinition["type"], SheetColumnType> = {
  TEXT: "TEXT",
  NUMBER: "NUMBER",
  DATE: "DATE",
  BOOLEAN: "CHECKBOX",
  SELECT: "SELECT",
  CPF: "CPF",
};

export function customCrmFields(entity: CrmEntity, definitions: readonly CrmCustomFieldDefinition[]): CrmField[] {
  const target = entity === "contacts" ? "CONTACT" : "DEAL";
  return definitions
    .filter((definition) => definition.entityType === target)
    .map((definition) => ({
      key: `custom:${definition.id}`,
      customFieldId: definition.id,
      label: definition.label,
      type: CUSTOM_TYPE_TO_SHEET[definition.type],
      writable: true,
      config: definition.type === "SELECT" ? { options: definition.options } : undefined,
      description: "Campo personalizado do CRM",
    }));
}

export function connectorWithCustomFields(entity: CrmEntity, definitions: readonly CrmCustomFieldDefinition[]): CrmConnector {
  const base = CRM_CONNECTORS[entity];
  return { ...base, fields: [...base.fields, ...customCrmFields(entity, definitions)] };
}

export function crmColumnBinding(config: unknown): { entity: CrmEntity; field: string } | null {
  const crm = config && typeof config === "object" && !Array.isArray(config) ? (config as { crm?: unknown }).crm : null;
  if (!crm || typeof crm !== "object" || Array.isArray(crm)) return null;
  const binding = crm as { entity?: unknown; field?: unknown };
  return isCrmEntity(binding.entity) && typeof binding.field === "string" && binding.field ? { entity: binding.entity, field: binding.field } : null;
}

export function crmBoundConfig(entity: CrmEntity, field: CrmField): Record<string, unknown> {
  return { ...(field.config ?? {}), crm: { entity, field: field.key } };
}

export function isCompatibleCrmColumn(field: CrmField, type: SheetColumnType): boolean {
  if (field.type === type) return true;
  if ((field.type === "TEXT" || field.type === "LONG_TEXT") && (type === "TEXT" || type === "LONG_TEXT")) return true;
  if ((field.type === "NUMBER" || field.type === "CURRENCY") && (type === "NUMBER" || type === "CURRENCY")) return true;
  return false;
}

export type CrmWriteMapping = { fieldKey: string; columnId: string };

export const DEAL_STATUS_LABELS = { OPEN: "Em andamento", WON: "Ganho", LOST: "Perdido" } as const;

/**
 * Situação de cada registro antes de enviar:
 * - "ok": vai para a API do CRM, que aplica as regras dela (carteira,
 *   co-responsável, equipe) e recusa o que não pode — a recusa aparece no resultado;
 * - "claim": cliente SEM responsável — para quem é Consultor/Administrativo
 *   (role MEMBER), editar faz o CRM torná-lo responsável automaticamente;
 *   por isso fica de fora do envio, a menos que a pessoa marque que quer;
 * - "blocked": não existe mais no CRM.
 */
export type CrmWriteCheck = "ok" | "claim" | "blocked";

export function contactWriteCheck(role: string, responsavelId: string | null): CrmWriteCheck {
  return role === "MEMBER" && !responsavelId ? "claim" : "ok";
}

/**
 * Converte as células mapeadas no corpo parcial aceito pelas APIs do CRM.
 * Vazio é ignorado de propósito: nesta primeira versão integração nunca apaga
 * dado do CRM silenciosamente.
 */
export function buildCrmUpdatePayload(
  entity: CrmEntity,
  mappings: readonly CrmWriteMapping[],
  values: Readonly<Record<string, CellValue | undefined>>,
): Record<string, unknown> {
  const connector = CRM_CONNECTORS[entity];
  const writable = new Set(connector.fields.filter((field) => field.writable).map((field) => field.key));
  const payload: Record<string, unknown> = {};

  for (const mapping of mappings) {
    const customFieldId = mapping.fieldKey.startsWith("custom:") ? mapping.fieldKey.slice("custom:".length) : null;
    if (!customFieldId && !writable.has(mapping.fieldKey)) continue;
    const raw = values[mapping.columnId];
    if (raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0)) continue;
    if (customFieldId) {
      // Patch: só os campos mapeados mudam; os outros campos personalizados do registro ficam como estão.
      const custom = (payload.customFieldValuesPatch ?? {}) as Record<string, unknown>;
      custom[customFieldId] = raw;
      payload.customFieldValuesPatch = custom;
      continue;
    }
    if (entity === "contacts" && mapping.fieldKey === "tags") {
      const tags = Array.isArray(raw)
        ? raw.map(String).map((tag) => tag.trim()).filter(Boolean)
        : String(raw).split(/[;,]/).map((tag) => tag.trim()).filter(Boolean);
      payload.tags = [...new Set(tags)];
      continue;
    }
    // Responsável no CRM é UM membro: célula com vários (venda dividida) não é enviada.
    if (Array.isArray(raw) && connector.fields.find((field) => field.key === mapping.fieldKey)?.type === "USER") {
      if (raw.length === 1) payload[mapping.fieldKey] = raw[0];
      continue;
    }
    payload[mapping.fieldKey] = raw;
  }
  return payload;
}

export function crmPreviewText(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ") || "—";
  if (typeof value === "number") return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return String(value);
}
