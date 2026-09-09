/**
 * Preferência de e-mail automático da organização (ver lib/notification-settings.ts
 * pra chaves válidas e onde cada uma é lida). GET liberado só pra OWNER —
 * diferente de horário de atendimento (que qualquer membro pode ler pra
 * automação), isto não tem nenhuma tela não-OWNER que precise saber o valor
 * atual. PUT também só OWNER: decide se um alerta de segurança (senha
 * alterada, WhatsApp desconectado) sai ou não pro time inteiro, não é uma
 * configuração operacional comum de MANAGER.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { EMAIL_NOTIFICATION_OPTIONS, getEmailNotificationSettings, type EmailNotificationKey } from "@/lib/notification-settings";
import type { Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

const VALID_KEYS = new Set<string>(EMAIL_NOTIFICATION_OPTIONS.map((o) => o.key));

export async function GET() {
  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const settings = await getEmailNotificationSettings(access.organizationId);
    return NextResponse.json({ settings });
  });
}

export async function PUT(req: Request) {
  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  // SUBSTITUI o objeto inteiro, não faz merge com o que já estava salvo —
  // quem chama precisa mandar o estado completo (ver
  // email-notifications-form.tsx, que sempre manda todas as chaves).
  const body = await req.json().catch(() => ({}));
  const { settings } = body as { settings?: Record<string, unknown> };
  if (!settings || typeof settings !== "object") {
    return NextResponse.json({ error: "Configuração inválida" }, { status: 400 });
  }

  // Só aceita as chaves conhecidas com valor booleano — qualquer outra
  // coisa no corpo é ignorada silenciosamente (nunca grava lixo arbitrário
  // no JSON da organização a partir de um payload malformado).
  const clean: Partial<Record<EmailNotificationKey, boolean>> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (VALID_KEYS.has(key) && typeof value === "boolean") {
      clean[key as EmailNotificationKey] = value;
    }
  }

  return runWithTenant(access.organizationId, async () => {
    await prisma.organization.update({
      where: { id: access.organizationId },
      data: { emailNotificationSettings: clean as Prisma.InputJsonValue },
    });
    return NextResponse.json({ ok: true });
  });
}
