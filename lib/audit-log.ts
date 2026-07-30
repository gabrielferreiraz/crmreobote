import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

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
  | "MEMBER_INVITED"
  | "MEMBER_ROLE_CHANGED"
  | "MEMBER_DEACTIVATED"
  | "MEMBER_REACTIVATED"
  | "MEMBER_REMOVED"
  | "WHATSAPP_CONNECTED"
  | "WHATSAPP_DISCONNECTED"
  | "META_ADS_CONNECTED"
  | "META_ADS_DISCONNECTED"
  | "GOOGLE_CALENDAR_CONNECTED"
  | "GOOGLE_CALENDAR_DISCONNECTED";

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
  ip?: string | null;
}): Promise<void> {
  const { organizationId, actorUserId, actorName, action, targetType, targetId, detail, ip } = params;
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
          ip,
        },
      }),
    );
  } catch (err) {
    console.error(`[audit-log] falha ao registrar ${action}`, err);
  }
}
