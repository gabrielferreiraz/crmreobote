import { NextResponse } from "next/server";
import { z } from "zod";
import { runWithTenant } from "@/lib/tenant-context";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";
import { requireRegistrationAccess } from "@/lib/deal-registration/access";
import { DOCUMENT_RETENTION_DAYS, canWaiveRegistration } from "@/lib/deal-registration/rules";
import { loadRegistrationContext, saveRegistrationDraft } from "@/lib/deal-registration/service";
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

    await saveRegistrationDraft(access.organizationId, id, access.deal.contactId, { contact, registration });
    return NextResponse.json({ ok: true });
  });
}

const quotaSchema = z
  .object({
    groupNumber: text(20),
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
      const data = {
        groupNumber: q.groupNumber?.trim() || null,
        termMonths: q.termMonths ?? null,
        paymentMethod: q.paymentMethod ?? null,
      };
      await prisma.dealRegistration.upsert({
        where: { dealId: id },
        create: { organizationId: access.organizationId, dealId: id, ...data },
        update: data,
      });
      return NextResponse.json({ ok: true });
    }

    if (typeof body?.quotaRegistered !== "boolean") return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

    const done = body.quotaRegistered;
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
    return NextResponse.json({ ok: true });
  });
}
