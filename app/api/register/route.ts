import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma, prismaRaw } from "@/lib/prisma";
import { slugify } from "@/lib/slug";
import { DEFAULT_PIPELINE_NAME, DEFAULT_STAGES } from "@/lib/default-pipeline";
import { DEFAULT_LOSS_REASONS } from "@/lib/default-loss-reasons";
import { DEFAULT_PROCESS_PIPELINE_NAME, DEFAULT_PROCESS_STAGES } from "@/lib/default-process-pipeline";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { setTenantOnTx } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const { allowed, retryAfterMs } = rateLimit(`register:${ip}`, 10, 60 * 60 * 1000);
  if (!allowed) {
    return NextResponse.json(
      { error: "Muitas tentativas. Tente novamente em alguns minutos." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }

  const body = await req.json();
  const { name, email, password, organizationName } = body as {
    name?: string;
    email?: string;
    password?: string;
    organizationName?: string;
  };

  if (!name || !email || !password || !organizationName) {
    return NextResponse.json({ error: "Campos obrigatórios faltando" }, { status: 400 });
  }

  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: "A senha deve ter pelo menos 8 caracteres" },
      { status: 400 },
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "E-mail já cadastrado" }, { status: 409 });
  }

  const baseSlug = slugify(organizationName) || "empresa";
  let slug = baseSlug;
  let attempt = 0;
  while (await prisma.organization.findUnique({ where: { slug } })) {
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const result = await prismaRaw.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name, email, password: hashedPassword },
    });

    const organization = await tx.organization.create({
      data: { name: organizationName, slug },
    });

    // A organização acabou de ser criada agora — define o tenant pra esta
    // transação pra que as inserções seguintes (que já têm RLS com WITH CHECK)
    // sejam aceitas.
    await setTenantOnTx(tx, organization.id);

    await tx.organizationUser.create({
      data: { organizationId: organization.id, userId: user.id, role: "OWNER" },
    });

    const pipeline = await tx.pipeline.create({
      data: {
        organizationId: organization.id,
        name: DEFAULT_PIPELINE_NAME,
        isDefault: true,
        order: 0,
      },
    });

    await tx.pipelineStage.createMany({
      data: DEFAULT_STAGES.map((stage) => ({
        pipelineId: pipeline.id,
        name: stage.name,
        order: stage.order,
        color: stage.color,
        requiredFields: [...stage.requiredFields],
      })),
    });

    await tx.lossReason.createMany({
      data: DEFAULT_LOSS_REASONS.map((label, index) => ({
        organizationId: organization.id,
        label,
        order: index,
      })),
    });

    // Pipeline de pós-venda (Processos) — mesma ideia do pipeline de vendas
    // acima, só que pro módulo administrativo (ver lib/processes/create.ts,
    // que também cria isso sob demanda se uma organização mais antiga ainda
    // não tiver).
    const processPipeline = await tx.processPipeline.create({
      data: {
        organizationId: organization.id,
        name: DEFAULT_PROCESS_PIPELINE_NAME,
        isDefault: true,
        order: 0,
      },
    });

    await tx.processStage.createMany({
      data: DEFAULT_PROCESS_STAGES.map((stage) => ({
        pipelineId: processPipeline.id,
        name: stage.name,
        order: stage.order,
        color: stage.color,
        isFinal: stage.isFinal,
      })),
    });

    return { user, organization };
  });

  return NextResponse.json({ id: result.user.id, organizationId: result.organization.id });
}
