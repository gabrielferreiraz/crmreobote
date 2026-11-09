/**
 * Cadastro do cliente para o Ganho — leitura, rascunho, trava do Ganho e aviso
 * ao administrativo. Sempre chamado dentro de runWithTenant (RLS por
 * organização) e sempre filtrando por organizationId.
 */

import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { formatCurrency } from "@/lib/format";
import { resolveContactPhones } from "@/lib/phone-normalize";
import {
  findMissingRegistrationItems,
  summarizeMissing,
  DOCUMENT_RETENTION_DAYS,
  type MissingItem,
  type RegistrationSnapshot,
} from "./rules";

export type RegistrationContext = {
  deal: { id: string; ownerId: string; contactId: string; status: "OPEN" | "WON" | "LOST"; administratorId: string | null };
  contactName: string;
  snapshot: RegistrationSnapshot;
  documents: { id: string; kind: "PHOTO_ID" | "SOCIAL_CONTRACT" | "OTHER"; fileName: string; size: number; createdAt: Date }[];
  administratorId: string | null;
  requiresBankData: boolean;
  documentsWaived: boolean;
  missing: MissingItem[];
  completedAt: Date | null;
  waivedReason: string | null;
  quotaRegisteredAt: Date | null;
  documentsPurgedAt: Date | null;
};

/** A organização usa administradoras (módulo de Comissões)? Sem elas, o Ganho não pede cadastro. */
export async function organizationUsesRegistration(organizationId: string): Promise<boolean> {
  return (await prisma.consortiumAdministrator.count({ where: { organizationId, active: true } })) > 0;
}

export async function loadRegistrationContext(
  organizationId: string,
  dealId: string,
  administratorIdOverride?: string | null,
): Promise<RegistrationContext | null> {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId },
    select: {
      id: true,
      ownerId: true,
      contactId: true,
      status: true,
      administratorId: true,
      contact: {
        select: {
          name: true,
          email: true,
          whatsapp: true,
          phone: true,
          zipCode: true,
          address: true,
          addressNumber: true,
          neighborhood: true,
          city: true,
          state: true,
          company: true,
        },
      },
      registration: { include: { documents: { orderBy: { createdAt: "asc" } } } },
    },
  });
  if (!deal) return null;

  const administratorId = administratorIdOverride === undefined ? deal.administratorId : administratorIdOverride || null;
  const [administrator, otherWon] = await Promise.all([
    administratorId
      ? prisma.consortiumAdministrator.findFirst({ where: { id: administratorId, organizationId }, select: { requiresBankData: true } })
      : Promise.resolve(null),
    // Cliente que já comprou antes: a administradora já tem os documentos dele.
    prisma.deal.count({ where: { organizationId, contactId: deal.contactId, status: "WON", id: { not: deal.id } } }),
  ]);

  const r = deal.registration;
  const snapshot: RegistrationSnapshot = {
    contact: {
      email: deal.contact.email,
      whatsapp: deal.contact.whatsapp,
      phone: deal.contact.phone,
      zipCode: deal.contact.zipCode,
      address: deal.contact.address,
      addressNumber: deal.contact.addressNumber,
      neighborhood: deal.contact.neighborhood,
      city: deal.contact.city,
      state: deal.contact.state,
      company: deal.contact.company,
    },
    registration: {
      personType: r?.personType ?? "PF",
      cpf: r?.cpf ?? null,
      cnpj: r?.cnpj ?? null,
      profession: r?.profession ?? null,
      maritalStatus: r?.maritalStatus ?? null,
      monthlyIncome: r?.monthlyIncome != null ? Number(r.monthlyIncome) : null,
      groupNumber: r?.groupNumber ?? null,
      termMonths: r?.termMonths ?? null,
      paymentMethod: r?.paymentMethod ?? null,
      bankName: r?.bankName ?? null,
      bankAgency: r?.bankAgency ?? null,
      bankAccount: r?.bankAccount ?? null,
      bankAccountType: r?.bankAccountType ?? null,
    },
    documents: (r?.documents ?? []).map((d) => ({ kind: d.kind })),
  };

  const requiresBankData = administrator?.requiresBankData ?? false;
  // Cliente que já comprou, ou documentos já apagados pela retenção (o administrativo os baixou): não pede de novo.
  const documentsWaived = otherWon > 0 || r?.documentsPurgedAt != null;
  return {
    deal: { id: deal.id, ownerId: deal.ownerId, contactId: deal.contactId, status: deal.status, administratorId: deal.administratorId },
    contactName: deal.contact.name,
    snapshot,
    documents: (r?.documents ?? []).map((d) => ({ id: d.id, kind: d.kind, fileName: d.fileName, size: d.size, createdAt: d.createdAt })),
    administratorId,
    requiresBankData,
    documentsWaived,
    missing: findMissingRegistrationItems(snapshot, { requiresBankData, documentsWaived }),
    completedAt: r?.completedAt ?? null,
    waivedReason: r?.waivedReason ?? null,
    quotaRegisteredAt: r?.quotaRegisteredAt ?? null,
    documentsPurgedAt: r?.documentsPurgedAt ?? null,
  };
}

export type RegistrationDraftInput = {
  contact?: {
    email?: string | null;
    whatsapp?: string | null;
    zipCode?: string | null;
    address?: string | null;
    addressNumber?: string | null;
    addressComplement?: string | null;
    neighborhood?: string | null;
    city?: string | null;
    state?: string | null;
    company?: string | null;
  };
  registration?: {
    personType?: "PF" | "PJ";
    cpf?: string | null;
    cnpj?: string | null;
    profession?: string | null;
    maritalStatus?: string | null;
    monthlyIncome?: number | null;
    groupNumber?: string | null;
    termMonths?: number | null;
    paymentMethod?: string | null;
    bankName?: string | null;
    bankAgency?: string | null;
    bankAccount?: string | null;
    bankAccountType?: string | null;
  };
};

/** Só o que veio no corpo é gravado (rascunho parcial nunca apaga o resto). */
export async function saveRegistrationDraft(
  organizationId: string,
  dealId: string,
  contactId: string,
  input: RegistrationDraftInput,
): Promise<void> {
  if (input.contact) {
    const { whatsapp, ...rest } = input.contact;
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) data[key] = typeof value === "string" ? value.trim() || null : value;
    }
    if (whatsapp !== undefined) {
      const existing = await prisma.contact.findFirst({
        where: { id: contactId, organizationId },
        select: { phone: true, phoneNormalized: true, whatsapp: true, whatsappNormalized: true },
      });
      const phones = resolveContactPhones({ whatsapp: whatsapp?.trim() || null }, { existing });
      // Número inválido não entra (o campo continua como estava); a tela já valida a máscara.
      if (phones.issues.length === 0) {
        data.whatsapp = phones.whatsapp;
        data.whatsappNormalized = phones.whatsappNormalized;
      }
    }
    if (Object.keys(data).length > 0) {
      await prisma.contact.updateMany({ where: { id: contactId, organizationId }, data });
    }
  }

  if (input.registration) {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input.registration)) {
      if (value !== undefined) data[key] = typeof value === "string" ? value.trim() || null : value;
    }
    await prisma.dealRegistration.upsert({
      where: { dealId },
      create: { organizationId, dealId, ...data },
      update: data,
    });
  }
}

export type WonGateResult =
  | { ok: true; waived: boolean }
  | { ok: false; message: string; missing: MissingItem[] };

/**
 * Trava do Ganho: o cadastro precisa estar completo — ou Dono/Administrativo
 * dispensa com motivo. Só vale para quem usa administradoras. Negócio que já
 * é Ganho nunca é cobrado de novo (quem chama só consulta na transição).
 */
export async function evaluateWonGate(params: {
  organizationId: string;
  dealId: string;
  administratorId: string | null | undefined;
  canBypass: boolean;
  bypassReason?: string | null;
}): Promise<WonGateResult> {
  const { organizationId, dealId, administratorId, canBypass, bypassReason } = params;
  if (!(await organizationUsesRegistration(organizationId))) return { ok: true, waived: false };

  const reason = bypassReason?.trim();
  if (reason) {
    if (!canBypass) return { ok: false, message: "Complete o cadastro do cliente antes do Ganho.", missing: [] };
    return { ok: true, waived: true };
  }

  const ctx = await loadRegistrationContext(organizationId, dealId, administratorId ?? undefined);
  if (!ctx) return { ok: false, message: "Negócio não encontrado", missing: [] };
  if (ctx.missing.length === 0) return { ok: true, waived: false };
  return { ok: false, message: `Complete o cadastro do cliente antes do Ganho. ${summarizeMissing(ctx.missing)}`, missing: ctx.missing };
}

/** Carimba o cadastro como concluído (ou dispensado) na hora do Ganho. */
export async function markRegistrationWon(params: {
  organizationId: string;
  dealId: string;
  userId: string;
  waivedReason?: string | null;
}): Promise<void> {
  const { organizationId, dealId, userId, waivedReason } = params;
  const now = new Date();
  const data = waivedReason?.trim()
    ? { completedAt: now, completedById: userId, waivedReason: waivedReason.trim(), waivedAt: now, waivedById: userId }
    : { completedAt: now, completedById: userId, waivedReason: null, waivedAt: null, waivedById: null };
  await prisma.dealRegistration.upsert({
    where: { dealId },
    create: { organizationId, dealId, ...data },
    update: data,
  });
}

/**
 * Avisa o administrativo que há uma cota para cadastrar: uma tarefa para cada
 * pessoa da área (aparece no sino e na Agenda, e some quando ela conclui) +
 * push. Nunca derruba o Ganho — sempre chamado depois da resposta.
 */
export async function notifyAdministrativeQuotaRegistration(organizationId: string, dealId: string): Promise<void> {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId },
    select: {
      id: true,
      value: true,
      grossValue: true,
      contactId: true,
      contact: { select: { name: true } },
      owner: { select: { name: true } },
      administrator: { select: { name: true } },
      registration: { select: { waivedReason: true } },
    },
  });
  if (!deal) return;

  let recipients = await prisma.organizationUser.findMany({
    where: { organizationId, active: true, area: "ADMINISTRATIVO" },
    select: { userId: true },
  });
  if (recipients.length === 0) {
    recipients = await prisma.organizationUser.findMany({ where: { organizationId, active: true, role: "OWNER" }, select: { userId: true } });
  }
  if (recipients.length === 0) return;

  const credit = deal.grossValue ?? deal.value;
  const parts = [
    deal.administrator?.name,
    credit != null ? `Crédito ${formatCurrency(Number(credit))}` : null,
    `Consultor: ${deal.owner.name}`,
  ].filter(Boolean);
  const description = `${parts.join(" · ")}. Dados e documentos estão no negócio: baixe os documentos em até ${DOCUMENT_RETENTION_DAYS} dias, depois eles são apagados do servidor. Defina grupo, prazo e forma de pagamento da cota.${
    deal.registration?.waivedReason ? ` Atenção: o Ganho foi marcado SEM o cadastro completo (${deal.registration.waivedReason}).` : ""
  }`;
  const title = `Cadastrar cota: ${deal.contact.name}`;

  for (const { userId } of recipients) {
    // Uma tarefa aberta por pessoa e negócio — reabrir/ganhar de novo não duplica.
    const open = await prisma.task.findFirst({ where: { organizationId, dealId, ownerId: userId, title, completedAt: null }, select: { id: true } });
    if (!open) {
      await prisma.task.create({
        data: { organizationId, dealId, contactId: deal.contactId, ownerId: userId, type: "OTHER", title, description, dueAt: new Date() },
      });
    }
    await sendPushToUser(userId, {
      title: "Nova cota para cadastrar",
      body: `${deal.contact.name} · ${deal.administrator?.name ?? "venda ganha"}`,
      url: `/negocios/${dealId}`,
    }).catch((err) => console.error("[deal-registration] falha no push", err));
  }
}
