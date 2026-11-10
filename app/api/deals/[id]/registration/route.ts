import { NextResponse } from "next/server";
import { z } from "zod";
import { runWithTenant } from "@/lib/tenant-context";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";
import { requireRegistrationAccess } from "@/lib/deal-registration/access";
import { DOCUMENT_RETENTION_DAYS, QUOTA_DIGIT_RE, QUOTA_NUMBER_RE, canWaiveRegistration } from "@/lib/deal-registration/rules";
import {
  closeConsultantQuotaRegisteredTasks,
  loadRegistrationContext,
  notifyConsultantQuotaRegistered,
  saveRegistrationDraft,
  syncQuotaToProcess,
} from "@/lib/deal-registration/service";
import { diffQuotaSnapshots, diffRegistrationSnapshots, getDealAuditLabel, loadRegistrationAuditSnapshot } from "@/lib/deal-registration/audit";
import { logAudit } from "@/lib/audit-log";
import { getClientIp } from "@/lib/rate-limit";
import { BANK_ACCOUNT_TYPE_OPTIONS, MARITAL_STATUS_OPTIONS, PAYMENT_METHOD_OPTIONS, normalizeRegistrationCnpj, normalizeRegistrationCpf } from "@/lib/deal-registration/rules";

export const dynamic = "force-dynamic";

const text = (max: number) => z.string().trim().max(max).nullable().optional();

const bodySchema = z
  .object({
    contact: z
      .object({
        email: z.string().trim().max(200).email("E-mail inválido").nullable().optional().or(z.literal("")),
        whatsapp: text(40),
        zipCode: text(12),
        address: text(200),
        addressNumber: text(20),
        addressComplement: text(100),
        neighborhood: text(100),
        city: text(100),
        state: text(2),
        company: text(160),
      })
      .strict()
      .optional(),
    registration: z
      .object({
        personType: z.enum(["PF", "PJ"]).optional(),
        cpf: text(20),
        cnpj: text(24),
        profession: text(120),
        maritalStatus: z.enum(MARITAL_STATUS_OPTIONS).nullable().optional(),
        monthlyIncome: z.number().min(0).max(100_000_000).nullable().optional(),
        // Da cota vendida: quem preenche é o consultor (ver lib/deal-registration/rules.ts).
        groupNumber: z
          .string()
          .trim()
          .refine((v) => v === "" || /^\d{1,8}$/.test(v), "Grupo: use só números.")
          .nullable()
          .optional(),
        termMonths: z.number().int().min(1).max(600).nullable().optional(),
        paymentMethod: z.enum(PAYMENT_METHOD_OPTIONS).nullable().optional(),
        bankName: text(100),
        bankAgency: text(20),
        bankAccount: text(30),
        bankAccountType: z.enum(BANK_ACCOUNT_TYPE_OPTIONS).nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Estado do cadastro: valores, documentos e o que falta (para a administradora pedida em ?administratorId=). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await getCurrentMembership();
  if (!m) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(m.organizationId, async () => {
    const guard = await requireRegistrationAccess(id);
    if ("response" in guard) return guard.response;
    const { access } = guard;

    const administratorParam = new URL(req.url).searchParams.get("administratorId");
    const ctx = await loadRegistrationContext(access.organizationId, id, administratorParam === null ? undefined : administratorParam);
    if (!ctx) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    return NextResponse.json({
      contactName: ctx.contactName,
      contact: ctx.snapshot.contact,
      registration: ctx.snapshot.registration,
      documents: ctx.documents,
      requiresBankData: ctx.requiresBankData,
      documentsWaived: ctx.documentsWaived,
      missing: ctx.missing,
      completedAt: ctx.completedAt,
      waivedReason: ctx.waivedReason,
      quotaRegisteredAt: ctx.quotaRegisteredAt,
      documentsPurgedAt: ctx.documentsPurgedAt,
      retentionDays: DOCUMENT_RETENTION_DAYS,
      canBypass: access.canBypass,
      canWaive: canWaiveRegistration(m),
    });
  });
}

/** Salva o rascunho (parcial). Nunca marca o Ganho — isso é no PUT do negócio. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await getCurrentMembership();
  if (!m) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(m.organizationId, async () => {
    const guard = await requireRegistrationAccess(id);
    if ("response" in guard) return guard.response;
    const { access } = guard;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
    }
    const input = parsed.data;
    const registration = input.registration
      ? {
          ...input.registration,
          ...(input.registration.cpf !== undefined ? { cpf: normalizeRegistrationCpf(input.registration.cpf) } : {}),
          ...(input.registration.cnpj !== undefined ? { cnpj: normalizeRegistrationCnpj(input.registration.cnpj) } : {}),
        }
      : undefined;
    const contact = input.contact
      ? { ...input.contact, email: input.contact.email === "" ? null : input.contact.email, state: input.contact.state?.toUpperCase() }
      : undefined;

    // Auditoria: o que mudou de verdade (antes -> depois), por quem. Falha ao auditar nunca impede salvar.
    const auditBefore = await loadRegistrationAuditSnapshot(access.organizationId, id).catch(() => null);
    await saveRegistrationDraft(access.organizationId, id, access.deal.contactId, { contact, registration });
    if (auditBefore) {
      try {
        const auditAfter = await loadRegistrationAuditSnapshot(access.organizationId, id);
        const changes = diffRegistrationSnapshots(auditBefore, auditAfter);
        const pick = (snap: Record<string, unknown>) => ({
          groupNumber: (snap.groupNumber as string | null) ?? null,
          quotaNumber: (snap.quotaNumber as string | null) ?? null,
          quotaDigit: (snap.quotaDigit as string | null) ?? null,
        });
        if (changes.some((c) => c.field === "groupNumber")) {
          await syncQuotaToProcess({ organizationId: access.organizationId, dealId: id, prev: pick(auditBefore), next: pick(auditAfter) });
        }
        if (changes.length > 0) {
          await logAudit({
            organizationId: access.organizationId,
            actorUserId: access.userId,
            actorName: access.actorName,
            action: "DEAL_REGISTRATION_EDITED",
            targetType: "Deal",
            targetId: id,
            targetLabel: await getDealAuditLabel(access.organizationId, id),
            changes,
            ip: getClientIp(req),
          });
        }
      } catch (err) {
        console.error("[audit] falha ao registrar a edição do cadastro", err);
      }
    }
    return NextResponse.json({ ok: true });
  });
}

const quotaSchema = z
  .object({
    groupNumber: text(20),
    quotaNumber: z
      .string()
      .trim()
      .refine((v) => v === "" || QUOTA_NUMBER_RE.test(v), "Cota: use só números (até 6 dígitos).")
      .nullable()
      .optional(),
    quotaDigit: z
      .string()
      .trim()
      .refine((v) => v === "" || QUOTA_DIGIT_RE.test(v), "Dígito: use só números (até 2).")
      .nullable()
      .optional(),
    termMonths: z.number().int().min(1).max(600).nullable().optional(),
    paymentMethod: z.enum(PAYMENT_METHOD_OPTIONS).nullable().optional(),
  })
  .strict();

/** O administrativo marca (ou desmarca) que a cota já foi cadastrada na administradora. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await getCurrentMembership();
  if (!m) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(m.organizationId, async () => {
    const guard = await requireRegistrationAccess(id);
    if ("response" in guard) return guard.response;
    const { access } = guard;
    if (!access.canBypass) return NextResponse.json({ error: "Só o administrativo marca a cota como cadastrada." }, { status: 403 });

    const body = (await req.json().catch(() => null)) as { quotaRegistered?: unknown; quota?: unknown } | null;

    // Grupo, prazo e forma de pagamento: preenchidos pelo administrativo depois do Ganho.
    if (body?.quota !== undefined) {
      const parsedQuota = quotaSchema.safeParse(body.quota);
      if (!parsedQuota.success) return NextResponse.json({ error: parsedQuota.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
      const q = parsedQuota.data;
      const before = await prisma.dealRegistration.findUnique({
        where: { dealId: id },
        select: { groupNumber: true, quotaNumber: true, quotaDigit: true, termMonths: true, paymentMethod: true },
      });
      // Cota e dígito são do administrativo. Grupo, prazo e forma de pagamento são do consultor: aqui só são
      // aceitos quando o consultor ainda não informou (venda antiga) — nunca sobrescrevem o que ele preencheu.
      const data = {
        quotaNumber: q.quotaNumber?.trim() || null,
        quotaDigit: q.quotaDigit?.trim() || null,
        groupNumber: before?.groupNumber?.trim() ? before.groupNumber : q.groupNumber?.trim() || null,
        termMonths: before?.termMonths != null ? before.termMonths : (q.termMonths ?? null),
        paymentMethod: before?.paymentMethod?.trim() ? before.paymentMethod : (q.paymentMethod ?? null),
      };
      const quotaAuditBefore = await loadRegistrationAuditSnapshot(access.organizationId, id).catch(() => null);
      await prisma.dealRegistration.upsert({
        where: { dealId: id },
        create: { organizationId: access.organizationId, dealId: id, ...data },
        update: data,
      });
      await syncQuotaToProcess({
        organizationId: access.organizationId,
        dealId: id,
        prev: { groupNumber: before?.groupNumber ?? null, quotaNumber: before?.quotaNumber ?? null, quotaDigit: before?.quotaDigit ?? null },
        next: { groupNumber: data.groupNumber, quotaNumber: data.quotaNumber, quotaDigit: data.quotaDigit },
      });
      if (quotaAuditBefore) {
        try {
          const changes = diffQuotaSnapshots(quotaAuditBefore, await loadRegistrationAuditSnapshot(access.organizationId, id));
          if (changes.length > 0) {
            await logAudit({
              organizationId: access.organizationId,
              actorUserId: access.userId,
              actorName: access.actorName,
              action: "DEAL_QUOTA_UPDATED",
              targetType: "Deal",
              targetId: id,
              targetLabel: await getDealAuditLabel(access.organizationId, id),
              changes,
              ip: getClientIp(req),
            });
          }
        } catch (err) {
          console.error("[audit] falha ao registrar a alteração da cota", err);
        }
      }
      return NextResponse.json({ ok: true });
    }

    if (typeof body?.quotaRegistered !== "boolean") return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

    const done = body.quotaRegistered;
    if (done) {
      // A cota só vale como cadastrada com grupo (do consultor), cota e dígito (do administrativo) salvos.
      const saved = await prisma.dealRegistration.findUnique({ where: { dealId: id }, select: { groupNumber: true, quotaNumber: true, quotaDigit: true } });
      if (!saved?.groupNumber?.trim()) {
        return NextResponse.json({ error: "Falta o grupo: o consultor informa no cadastro do Ganho. Peça a ele nesta tela." }, { status: 400 });
      }
      if (!saved.quotaNumber?.trim() || !saved.quotaDigit?.trim()) {
        return NextResponse.json({ error: "Preencha a cota e o dígito e salve antes de marcar a cota como cadastrada." }, { status: 400 });
      }
    }
    const stamp = { quotaRegisteredAt: done ? new Date() : null, quotaRegisteredById: done ? access.userId : null };
    await prisma.dealRegistration.upsert({
      where: { dealId: id },
      create: { organizationId: access.organizationId, dealId: id, ...stamp },
      update: stamp,
    });
    // Cota cadastrada: as tarefas "Cadastrar cota" abertas desse negócio, de qualquer pessoa do administrativo, se resolvem juntas.
    if (done) {
      await prisma.task.updateMany({
        where: { organizationId: access.organizationId, dealId: id, completedAt: null, title: { startsWith: "Cadastrar cota:" } },
        data: { completedAt: new Date() },
      });
    }
    await logAudit({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      actorName: access.actorName,
      action: done ? "DEAL_QUOTA_REGISTERED" : "DEAL_QUOTA_REGISTRATION_UNDONE",
      targetType: "Deal",
      targetId: id,
      targetLabel: await getDealAuditLabel(access.organizationId, id),
      detail: done ? "Cota marcada como cadastrada na administradora." : "A cota voltou a ficar pendente.",
      ip: getClientIp(req),
    });
    // O consultor é avisado (sino + celular); se o administrativo desfez, o aviso antigo some.
    if (done) await notifyConsultantQuotaRegistered({ organizationId: access.organizationId, dealId: id, actor: { userId: access.userId, name: access.actorName } });
    else await closeConsultantQuotaRegisteredTasks(access.organizationId, id);
    return NextResponse.json({ ok: true });
  });
}
