/**
 * Rótulos, cores e módulos da auditoria — usado pela tela de auditoria, pelo
 * histórico por venda e pela exportação. Sem banco nem servidor: pode ser
 * importado de qualquer componente.
 */

import type { AuditAction } from "@/lib/audit-log";

export type AuditTone = "neutral" | "success" | "danger" | "warning";

export const ACTION_LABELS: Record<AuditAction, string> = {
  LOGIN_SUCCESS: "Login",
  LOGIN_FAILED: "Login falhou",
  API_KEY_CREATED: "Chave de API criada",
  API_KEY_REVOKED: "Chave de API revogada",
  TV_DISPLAY_LINK_CREATED: "Link público da TV gerado",
  TV_DISPLAY_LINK_REVOKED: "Link público da TV revogado",
  MEMBER_INVITED: "Membro convidado",
  MEMBER_ROLE_CHANGED: "Papel de membro alterado",
  MEMBER_DEACTIVATED: "Membro desativado",
  MEMBER_REACTIVATED: "Membro reativado",
  MEMBER_REMOVED: "Membro removido",
  ACADEMY_CRM_UNLOCKED: "CRM liberado pela Academy",
  ACADEMY_CRM_MANUALLY_UNLOCKED: "CRM liberado manualmente",
  ACADEMY_ONBOARDING_REQUIRED: "Treinamento da Academy exigido",
  ACADEMY_ONBOARDING_EXEMPTED: "Exigência da Academy removida",
  WHATSAPP_CONNECTED: "WhatsApp conectado",
  WHATSAPP_DISCONNECTED: "WhatsApp desconectado",
  META_ADS_CONNECTED: "Meta Ads conectado",
  META_ADS_DISCONNECTED: "Meta Ads desconectado",
  GOOGLE_CALENDAR_CONNECTED: "Google Agenda conectado",
  GOOGLE_CALENDAR_DISCONNECTED: "Google Agenda desconectado",
  DEALS_IMPORTED: "Negócios importados",
  CONTACTS_IMPORTED: "Contatos importados",
  SERVOPA_TABLE_ADJUSTMENT: "Taxa de tabela Servopa ajustada",
  SERVOPA_SYNC_REQUESTED: "Atualização Servopa solicitada",
  SERVOPA_SYNC_CANCELLED: "Atualização Servopa cancelada",
  SERVOPA_WORKER_CREDENTIAL_CREATED: "Computador conectado ao robô Servopa",
  SERVOPA_WORKER_CREDENTIAL_REVOKED: "Computador removido do robô Servopa",
  SERVOPA_WORKER_INSTALLER_DOWNLOADED: "Instalador do robô Servopa baixado",
  SERVOPA_CAMPAIGN_CREATED: "Campanha do PDF das tabelas criada",
  SERVOPA_CAMPAIGN_UPDATED: "Campanha do PDF das tabelas alterada",
  SERVOPA_CAMPAIGN_DELETED: "Campanha do PDF das tabelas apagada",
  SHEET_CREATED: "Planilha criada",
  SHEET_ARCHIVED: "Planilha arquivada",
  SHEET_RESTORED: "Planilha restaurada",
  SHEET_DELETED: "Planilha apagada permanentemente",
  SHEET_IMPORTED: "Dados importados para planilha",
  SHEET_EXPORTED: "Planilha exportada",
  DEAL_REGISTRATION_WAIVED: "Ganho sem o cadastro do cliente",
  DEAL_REGISTRATION_DOC_DOWNLOADED: "Documento do cliente baixado",
  DEAL_REGISTRATION_DOC_DELETED: "Documento do cliente apagado",
  DEAL_REGISTRATION_DOCS_PURGED: "Documentos do cliente apagados (prazo de 7 dias)",
  DEAL_DOCUMENT_REQUESTED: "Documento pedido ao consultor",
  DEAL_DOCUMENT_REQUEST_CANCELLED: "Pedido de documento cancelado",
  WHATSAPP_BACKUP_EXPORTED: "Backup de mensagens exportado",
  CAMPAIGN_QUEUE_REORDERED: "Fila de disparo reordenada",
  CAMPAIGN_RECIPIENT_REMOVED: "Contato removido da fila",
  CAMPAIGN_AUTO_PAUSED: "Campanha pausada automaticamente",
  CAMPAIGN_AUTO_RESUMED: "Campanha retomada automaticamente",
  COMMISSION_SETTINGS_CHANGED: "Configuração de comissões alterada",
  COMMISSION_MANAGER_CHANGED: "Responsável por comissões alterado",
  COMMISSION_ADMINISTRATOR_CHANGED: "Administradora alterada",
  COMMISSION_RULE_CHANGED: "Regra de comissão alterada",
  COMMISSION_SALE_CHANGED: "Venda de comissão alterada",
  COMMISSION_PAID: "Comissão paga",
  COMMISSION_UNPAID: "Pagamento de comissão desfeito",
  COMMISSION_HELD: "Comissão travada",
  COMMISSION_RELEASED: "Comissão destravada",
  COMMISSION_ADJUSTMENT: "Ajuste de comissão",
  COMMISSION_DISPUTE_RESOLVED: "Contestação de comissão respondida",
  COMMISSION_INDIVIDUAL_GOAL_CHANGED: "Meta individual de comissão alterada",
  COMMISSION_BONUS_RULE_CHANGED: "Regra de bônus por meta alterada",
  COMMISSION_BONUS_CALCULATED: "Bônus por meta calculado",
  CENTRAL_CONTACT_CREATED: "Contato criado pela Central",
  CENTRAL_SETTINGS_CHANGED: "Central de Leads alterada",
  LISTA_50_CAMPAIGN_CHANGED: "Campanha Lista dos 50 alterada",
  CONTACT_OWNER_TRANSFERRED: "Responsável do contato transferido via API",
  DEAL_DOCUMENT_REQUEST_ANSWERED: "Consultor atendeu um item do pedido",
  DEAL_DOCUMENT_REQUEST_FULFILLED: "Pedido de documento atendido por completo",
  DEAL_REGISTRATION_EDITED: "Dados do cadastro do cliente editados",
  DEAL_REGISTRATION_COMPLETED: "Cadastro do cliente concluído no Ganho",
  DEAL_REGISTRATION_DOC_UPLOADED: "Documento do cliente enviado",
  DEAL_QUOTA_UPDATED: "Grupo, cota ou dados da cota alterados",
  DEAL_QUOTA_REGISTERED: "Cota marcada como cadastrada",
  DEAL_QUOTA_REGISTRATION_UNDONE: "Cota desmarcada (voltou a pendente)",
  DEAL_REGISTRATION_DOC_VIEWED: "Documento do cliente aberto",
  DEAL_DATA_COPIED: "Dados do cliente copiados",
  DEAL_REGISTRATION_DOCS_SENT: "Documentos extras enviados ao administrativo",
  DEAL_WON: "Negócio marcado como ganho",
  DEAL_LOST: "Negócio marcado como perdido",
  DEAL_REOPENED: "Negócio reaberto",
  DEAL_OWNER_CHANGED: "Responsável do negócio trocado",
  DEAL_VALUE_CHANGED: "Valor do negócio alterado",
  DEAL_DELETED: "Negócio apagado",
  DEAL_ARCHIVED: "Negócio arquivado",
  DEAL_UNARCHIVED: "Negócio desarquivado",
  MEMBER_AREA_CHANGED: "Área da pessoa alterada",
  MEMBER_PERMISSIONS_CHANGED: "Permissões da pessoa alteradas",
  MEMBER_TEAM_CHANGED: "Equipe da pessoa alterada",
  MEMBER_PROFILE_CHANGED: "Dados do perfil da pessoa alterados",
  AUDIT_EXPORTED: "Auditoria exportada",
};

export const ACTION_TONE: Record<AuditAction, "neutral" | "success" | "danger" | "warning"> = {
  LOGIN_SUCCESS: "neutral",
  LOGIN_FAILED: "danger",
  API_KEY_CREATED: "success",
  API_KEY_REVOKED: "warning",
  TV_DISPLAY_LINK_CREATED: "success",
  TV_DISPLAY_LINK_REVOKED: "warning",
  MEMBER_INVITED: "success",
  MEMBER_ROLE_CHANGED: "warning",
  MEMBER_DEACTIVATED: "danger",
  MEMBER_REACTIVATED: "success",
  MEMBER_REMOVED: "danger",
  ACADEMY_CRM_UNLOCKED: "success",
  ACADEMY_CRM_MANUALLY_UNLOCKED: "warning",
  ACADEMY_ONBOARDING_REQUIRED: "warning",
  ACADEMY_ONBOARDING_EXEMPTED: "neutral",
  WHATSAPP_CONNECTED: "success",
  WHATSAPP_DISCONNECTED: "warning",
  META_ADS_CONNECTED: "success",
  META_ADS_DISCONNECTED: "warning",
  GOOGLE_CALENDAR_CONNECTED: "success",
  GOOGLE_CALENDAR_DISCONNECTED: "warning",
  DEALS_IMPORTED: "neutral",
  CONTACTS_IMPORTED: "neutral",
  SERVOPA_TABLE_ADJUSTMENT: "warning",
  SERVOPA_SYNC_REQUESTED: "neutral",
  SERVOPA_SYNC_CANCELLED: "warning",
  SERVOPA_WORKER_CREDENTIAL_CREATED: "success",
  SERVOPA_WORKER_CREDENTIAL_REVOKED: "warning",
  SERVOPA_WORKER_INSTALLER_DOWNLOADED: "neutral",
  SERVOPA_CAMPAIGN_CREATED: "success",
  SERVOPA_CAMPAIGN_UPDATED: "neutral",
  SERVOPA_CAMPAIGN_DELETED: "warning",
  SHEET_CREATED: "success",
  SHEET_ARCHIVED: "warning",
  SHEET_RESTORED: "neutral",
  SHEET_DELETED: "danger",
  SHEET_IMPORTED: "neutral",
  SHEET_EXPORTED: "warning", // dados saindo do CRM em massa
  DEAL_REGISTRATION_WAIVED: "warning",
  DEAL_REGISTRATION_DOC_DOWNLOADED: "neutral",
  DEAL_REGISTRATION_DOC_DELETED: "warning",
  DEAL_REGISTRATION_DOCS_PURGED: "neutral",
  DEAL_DOCUMENT_REQUESTED: "neutral",
  DEAL_DOCUMENT_REQUEST_CANCELLED: "neutral",
  WHATSAPP_BACKUP_EXPORTED: "warning", // conversa privada saindo do CRM
  CAMPAIGN_QUEUE_REORDERED: "warning", // muda QUEM é contatado primeiro — vale destacar
  CAMPAIGN_RECIPIENT_REMOVED: "warning",
  CAMPAIGN_AUTO_PAUSED: "warning", // a campanha parou sem ninguém mandar — é o que se procura quando "parou sozinha"
  CAMPAIGN_AUTO_RESUMED: "success",
  COMMISSION_SETTINGS_CHANGED: "warning",
  COMMISSION_MANAGER_CHANGED: "warning", // muda quem enxerga a comissão de todo mundo
  COMMISSION_ADMINISTRATOR_CHANGED: "neutral",
  COMMISSION_RULE_CHANGED: "warning",
  COMMISSION_SALE_CHANGED: "neutral",
  COMMISSION_PAID: "success",
  COMMISSION_UNPAID: "danger",
  COMMISSION_HELD: "warning",
  COMMISSION_RELEASED: "neutral",
  COMMISSION_ADJUSTMENT: "warning",
  COMMISSION_DISPUTE_RESOLVED: "neutral",
  COMMISSION_INDIVIDUAL_GOAL_CHANGED: "neutral",
  COMMISSION_BONUS_RULE_CHANGED: "warning",
  COMMISSION_BONUS_CALCULATED: "warning",
  CENTRAL_CONTACT_CREATED: "neutral",
  CENTRAL_SETTINGS_CHANGED: "warning",
  LISTA_50_CAMPAIGN_CHANGED: "warning",
  CONTACT_OWNER_TRANSFERRED: "warning",
  DEAL_DOCUMENT_REQUEST_ANSWERED: "success",
  DEAL_DOCUMENT_REQUEST_FULFILLED: "success",
  DEAL_REGISTRATION_EDITED: "neutral",
  DEAL_REGISTRATION_COMPLETED: "success",
  DEAL_REGISTRATION_DOC_UPLOADED: "neutral",
  DEAL_QUOTA_UPDATED: "neutral",
  DEAL_QUOTA_REGISTERED: "success",
  DEAL_QUOTA_REGISTRATION_UNDONE: "warning",
  DEAL_REGISTRATION_DOC_VIEWED: "neutral",
  DEAL_DATA_COPIED: "neutral",
  DEAL_REGISTRATION_DOCS_SENT: "success",
  DEAL_WON: "success",
  DEAL_LOST: "danger",
  DEAL_REOPENED: "warning",
  DEAL_OWNER_CHANGED: "warning",
  DEAL_VALUE_CHANGED: "warning",
  DEAL_DELETED: "danger",
  // Arquivar não apaga, mas some com o negócio para a organização inteira.
  DEAL_ARCHIVED: "warning",
  DEAL_UNARCHIVED: "neutral",
  MEMBER_AREA_CHANGED: "warning",
  MEMBER_PERMISSIONS_CHANGED: "warning",
  MEMBER_TEAM_CHANGED: "neutral",
  MEMBER_PROFILE_CHANGED: "neutral",
  AUDIT_EXPORTED: "warning",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action as AuditAction] ?? action;
}

export function actionTone(action: string): AuditTone {
  return ACTION_TONE[action as AuditAction] ?? "neutral";
}

/** Módulo da ação: é o que o filtro "Área do sistema" usa. Ação nova sem regra cai em "Outros". */
export const AUDIT_CATEGORIES = [
  { id: "acesso", label: "Acesso e login", prefixes: ["LOGIN_"] },
  { id: "equipe", label: "Equipe e permissões", prefixes: ["MEMBER_", "ACADEMY_"] },
  { id: "cadastro", label: "Cadastro e cota", prefixes: ["DEAL_REGISTRATION_", "DEAL_DOCUMENT_", "DEAL_QUOTA_", "DEAL_DATA_"] },
  { id: "negocios", label: "Negócios", prefixes: ["DEAL_", "DEALS_", "CONTACT_", "CONTACTS_"] },
  { id: "comissoes", label: "Comissões", prefixes: ["COMMISSION_"] },
  { id: "whatsapp", label: "WhatsApp e campanhas", prefixes: ["WHATSAPP_", "CAMPAIGN_", "CENTRAL_", "LISTA_50_"] },
  { id: "servopa", label: "Tabelas Servopa", prefixes: ["SERVOPA_"] },
  { id: "planilhas", label: "Planilhas", prefixes: ["SHEET_"] },
  { id: "integracoes", label: "Integrações e chaves", prefixes: ["API_KEY_", "META_ADS_", "GOOGLE_CALENDAR_", "TV_DISPLAY_"] },
  { id: "auditoria", label: "Auditoria", prefixes: ["AUDIT_"] },
] as const;

export type AuditCategoryId = (typeof AUDIT_CATEGORIES)[number]["id"] | "outros";

/** A primeira categoria cujo prefixo casa (as mais específicas vêm antes das genéricas). */
export function categoryOf(action: string): AuditCategoryId {
  for (const c of AUDIT_CATEGORIES) {
    if (c.prefixes.some((p) => action.startsWith(p))) return c.id;
  }
  return "outros";
}

export function categoryLabel(id: string): string {
  return AUDIT_CATEGORIES.find((c) => c.id === id)?.label ?? "Outros";
}

/** Ações de uma categoria (para filtrar no banco): devolve os prefixos, ou null se for "outros". */
export function categoryPrefixes(id: string): readonly string[] | null {
  return AUDIT_CATEGORIES.find((c) => c.id === id)?.prefixes ?? null;
}

/** Para onde o item auditado leva (quando existe uma tela para ele). */
export function targetHref(targetType: string | null, targetId: string | null): string | null {
  if (!targetType || !targetId) return null;
  if (targetType === "Deal") return `/negocios/${targetId}`;
  if (targetType === "Contact") return `/clientes/${targetId}`;
  return null;
}
