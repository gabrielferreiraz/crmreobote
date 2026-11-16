import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { summarizeChanges, type AuditChange } from "@/lib/audit-diff";

/**
 * Ações administrativas cobertas hoje (ver comentário do model AuditLog em
 * schema.prisma) — string livre, não enum, então adicionar uma nova ação não
 * exige migration. Mantém essa lista como referência de nomenclatura.
 */
export type AuditAction =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "API_KEY_CREATED"
  | "API_KEY_REVOKED"
  | "TV_DISPLAY_LINK_CREATED"
  | "TV_DISPLAY_LINK_REVOKED"
  | "MEMBER_INVITED"
  | "MEMBER_ROLE_CHANGED"
  | "MEMBER_DEACTIVATED"
  | "MEMBER_REACTIVATED"
  | "MEMBER_REMOVED"
  | "ACADEMY_CRM_UNLOCKED"
  | "ACADEMY_CRM_MANUALLY_UNLOCKED"
  | "ACADEMY_ONBOARDING_REQUIRED"
  | "ACADEMY_ONBOARDING_EXEMPTED"
  | "WHATSAPP_CONNECTED"
  | "WHATSAPP_DISCONNECTED"
  | "META_ADS_CONNECTED"
  | "META_ADS_DISCONNECTED"
  | "GOOGLE_CALENDAR_CONNECTED"
  | "GOOGLE_CALENDAR_DISCONNECTED"
  | "DEALS_IMPORTED"
  | "CONTACTS_IMPORTED"
  | "SERVOPA_TABLE_ADJUSTMENT"
  | "SERVOPA_SYNC_REQUESTED"
  | "SERVOPA_SYNC_CANCELLED"
  | "SERVOPA_WORKER_CREDENTIAL_CREATED"
  | "SERVOPA_WORKER_CREDENTIAL_REVOKED"
  | "SERVOPA_WORKER_INSTALLER_DOWNLOADED"
  // Campanhas do PDF das tabelas (arte do cabeçalho): o que o cliente recebe muda.
  | "SERVOPA_CAMPAIGN_CREATED"
  | "SERVOPA_CAMPAIGN_UPDATED"
  | "SERVOPA_CAMPAIGN_DELETED"
  // Fila de disparo de uma campanha reordenada à mão (arrastar / mover pro topo
  // ou fim) — muda QUEM é contatado primeiro, então fica registrado quem mexeu.
  | "CAMPAIGN_QUEUE_REORDERED"
  | "CAMPAIGN_RECIPIENT_REMOVED"
  // O motor pausou/retomou uma campanha SOZINHO por causa do WhatsApp (caiu / voltou), ou pausou
  // depois de 5 falhas seguidas — sem isso ninguém saberia por que ela parou nem quando voltou.
  | "CAMPAIGN_AUTO_PAUSED"
  | "CAMPAIGN_AUTO_RESUMED"
  // Comissões (ver lib/commissions/) — tudo que mexe em quanto alguém
  // recebe fica registrado: cadastro (administradora/regra/configuração/
  // quem cuida), conferência de venda e cada parcela paga/travada/ajustada.
  | "COMMISSION_SETTINGS_CHANGED"
  | "COMMISSION_MANAGER_CHANGED"
  | "COMMISSION_ADMINISTRATOR_CHANGED"
  | "COMMISSION_RULE_CHANGED"
  | "COMMISSION_SALE_CHANGED"
  | "COMMISSION_PAID"
  | "COMMISSION_UNPAID"
  | "COMMISSION_HELD"
  | "COMMISSION_RELEASED"
  | "COMMISSION_ADJUSTMENT"
  | "COMMISSION_DISPUTE_RESOLVED"
  // Bônus por meta batida (ver lib/commissions/bonus-run.ts): meta individual
  // cadastrada, regra de bônus criada/editada/apagada, e cada vez que o
  // Financeiro manda calcular os bônus de um mês.
  | "COMMISSION_INDIVIDUAL_GOAL_CHANGED"
  | "COMMISSION_BONUS_RULE_CHANGED"
  | "COMMISSION_BONUS_CALCULATED"
  // Central de Leads (ver lib/whatsapp/lead-routing.ts): contato criado pelo
  // sistema na 1ª mensagem, e conexão/pool da Central mexidos pelo Dono.
  | "CENTRAL_CONTACT_CREATED"
  | "CENTRAL_SETTINGS_CHANGED"
  // Planilhas do Administrativo (ver lib/sheets/): estrutura e entrada/saída
  // de dados em massa. Edição de célula fica no histórico próprio (SheetActivity).
  | "SHEET_CREATED"
  | "SHEET_ARCHIVED"
  | "SHEET_RESTORED"
  | "SHEET_DELETED"
  | "SHEET_IMPORTED"
  | "SHEET_EXPORTED"
  // Cadastro do cliente no Ganho: documentos e dados bancários são sensíveis (LGPD) — quem baixou e quem dispensou o formulário fica registrado.
  | "DEAL_REGISTRATION_WAIVED"
  | "DEAL_REGISTRATION_DOC_DOWNLOADED"
  | "DEAL_REGISTRATION_DOC_DELETED"
  | "DEAL_REGISTRATION_DOCS_PURGED"
  | "DEAL_DOCUMENT_REQUESTED"
  | "DEAL_DOCUMENT_REQUEST_CANCELLED"
  // Negócio arquivado/desarquivado (ver Deal.archivedAt): não apaga nada, mas
  // tira o negócio da vista de TODO mundo da organização — quem sumiu com o
  // negócio de outra pessoa precisa ficar registrado.
  | "DEAL_ARCHIVED"
  | "DEAL_UNARCHIVED"
  | "DEAL_DOCUMENT_REQUEST_ANSWERED"
  | "DEAL_DOCUMENT_REQUEST_FULFILLED"
  // Cadastro do cliente e da cota: cada dado editado (antes -> depois), quem enviou documento e quem marcou a cota.
  | "DEAL_REGISTRATION_EDITED"
  | "DEAL_REGISTRATION_COMPLETED"
  | "DEAL_REGISTRATION_DOC_UPLOADED"
  | "DEAL_QUOTA_UPDATED"
  | "DEAL_QUOTA_REGISTERED"
  | "DEAL_QUOTA_REGISTRATION_UNDONE"
  // Acesso do administrativo aos dados sensíveis do cliente (LGPD): quem abriu o documento e quem copiou dados.
  | "DEAL_REGISTRATION_DOC_VIEWED"
  | "DEAL_DATA_COPIED"
  // O consultor enviou documentos extras de uma venda já ganha e o administrativo foi avisado.
  | "DEAL_REGISTRATION_DOCS_SENT"
  // Negócios: o que muda dinheiro, dono ou situação da venda.
  | "DEAL_WON"
  | "DEAL_LOST"
  | "DEAL_REOPENED"
  | "DEAL_OWNER_CHANGED"
  | "DEAL_VALUE_CHANGED"
  | "DEAL_DELETED"
  // Pessoas: área, permissões, equipe e dados do perfil (o papel e a ativação já tinham evento próprio).
  | "MEMBER_AREA_CHANGED"
  | "MEMBER_PERMISSIONS_CHANGED"
  | "MEMBER_TEAM_CHANGED"
  | "MEMBER_PROFILE_CHANGED"
  // A própria trilha de auditoria saindo do CRM.
  | "AUDIT_EXPORTED"
  // Histórico de WhatsApp de um consultor baixado pelo Dono (conversa privada de outra pessoa saindo do CRM).
  | "WHATSAPP_BACKUP_EXPORTED"
  // Campanha sazonal "Lista dos 50" (Novembro Black) ligada/desligada pelo Dono.
  | "LISTA_50_CAMPAIGN_CHANGED"
  // Transferência explícita de responsável de contato via API externa
  // (PATCH /api/v1/contacts/:id/owner — ver lib/lead-claim.ts pra regra).
  | "CONTACT_OWNER_TRANSFERRED";

/**
 * Registra um evento de auditoria — nunca deve quebrar a ação real que está
 * sendo auditada (login, revogação de chave, desativação de membro etc.),
 * então qualquer falha aqui só vai pro log de erro, nunca propaga. Precisa
 * do organizationId resolvido pelo chamador porque a policy de RLS de
 * AuditLog exige tenant_isolation normal (ver migration
 * 20260728120000_api_key_expiry_and_audit_log) — diferente do login em si,
 * aqui a ação só é logada depois que já se sabe a organização.
 */
export async function logAudit(params: {
  organizationId: string;
  actorUserId?: string | null;
  actorName: string;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  detail?: string | null;
  /** Nome do item (ex.: o cliente), para a tela mostrar gente e não código. */
  targetLabel?: string | null;
  /** O que mudou, antes -> depois (ver lib/audit-diff.ts). Se não houver detalhe, ele é gerado a partir daqui. */
  changes?: AuditChange[];
  ip?: string | null;
}): Promise<void> {
  const { organizationId, actorUserId, actorName, action, targetType, targetId, ip } = params;
  const changes = params.changes && params.changes.length > 0 ? params.changes : undefined;
  const detail = params.detail ?? (changes ? summarizeChanges(changes) : null);
  try {
    await runWithTenant(organizationId, () =>
      prisma.auditLog.create({
        data: {
          organizationId,
          actorUserId: actorUserId ?? null,
          actorName,
          action,
          targetType,
          targetId,
          detail: detail ?? undefined,
          targetLabel: params.targetLabel ?? undefined,
          changes: changes as unknown as object | undefined,
          ip,
        },
      }),
    );
  } catch (err) {
    console.error(`[audit-log] falha ao registrar ${action}`, err);
  }
}

/**
 * Vários eventos de uma vez (ação em massa: um evento POR item, para o histórico
 * de cada venda/cliente continuar completo). Mesma regra do logAudit: nunca propaga erro.
 */
export async function logAuditMany(params: {
  organizationId: string;
  actorUserId?: string | null;
  actorName: string;
  ip?: string | null;
  entries: {
    action: AuditAction;
    targetType?: string;
    targetId?: string;
    targetLabel?: string | null;
    detail?: string | null;
    changes?: AuditChange[];
  }[];
}): Promise<void> {
  const { organizationId, actorUserId, actorName, ip, entries } = params;
  if (entries.length === 0) return;
  try {
    for (let i = 0; i < entries.length; i += 1000) {
      const chunk = entries.slice(i, i + 1000);
      await runWithTenant(organizationId, () =>
        prisma.auditLog.createMany({
          data: chunk.map((e) => ({
            organizationId,
            actorUserId: actorUserId ?? null,
            actorName,
            action: e.action,
            targetType: e.targetType,
            targetId: e.targetId,
            targetLabel: e.targetLabel ?? undefined,
            detail: e.detail ?? (e.changes && e.changes.length > 0 ? summarizeChanges(e.changes) : undefined),
            changes: e.changes && e.changes.length > 0 ? (e.changes as unknown as object) : undefined,
            ip,
          })),
        }),
      );
    }
  } catch (err) {
    console.error(`[audit-log] falha ao registrar ${entries.length} evento(s) em massa`, err);
  }
}
