import { NextResponse } from "next/server";
import { runWithTenant } from "@/lib/tenant-context";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";
import { requireRegistrationAccess } from "@/lib/deal-registration/access";
import { REGISTRATION_DOC_MAX_FILES } from "@/lib/deal-registration/rules";
import {
  RegistrationDocUploadError,
  assertValidRegistrationDoc,
  buildRegistrationDocKey,
  deleteRegistrationDoc,
  prepareRegistrationDoc,
  uploadRegistrationDoc,
} from "@/lib/r2";
import { rateLimitOrResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const EXT_TYPES: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
const KINDS = new Set(["PHOTO_ID", "SOCIAL_CONTRACT", "OTHER"]);

/** Envia um documento do cliente (foto ou PDF) para o cadastro do negócio. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await getCurrentMembership();
  if (!m) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(m.organizationId, async () => {
    const guard = await requireRegistrationAccess(id);
    if ("response" in guard) return guard.response;
    const { access } = guard;

    const limited = rateLimitOrResponse(`deal-registration-doc:${access.userId}`, 40, 10 * 60_000);
    if (limited) return limited;

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const kind = String(form?.get("kind") ?? "");
    if (!(file instanceof File) || !KINDS.has(kind)) {
      return NextResponse.json({ error: "Arquivo inválido" }, { status: 400 });
    }

    const registration = await prisma.dealRegistration.upsert({
      where: { dealId: id },
      create: { organizationId: access.organizationId, dealId: id },
      update: {},
      select: { id: true, _count: { select: { documents: true } } },
    });
    if (registration._count.documents >= REGISTRATION_DOC_MAX_FILES) {
      return NextResponse.json({ error: `Limite de ${REGISTRATION_DOC_MAX_FILES} arquivos neste cadastro.` }, { status: 400 });
    }

    // Alguns navegadores/celulares mandam o arquivo sem tipo: deduz pela extensão (o conteúdo é conferido pelos bytes de qualquer jeito).
    const contentType = file.type || EXT_TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""] || "";
    const original = Buffer.from(await file.arrayBuffer());
    let stored: Buffer;
    try {
      assertValidRegistrationDoc(contentType, original.length, original);
      stored = await prepareRegistrationDoc(original, contentType);
    } catch (err) {
      if (err instanceof RegistrationDocUploadError) return NextResponse.json({ error: err.message }, { status: 400 });
      return NextResponse.json({ error: "Não foi possível ler esse arquivo. Tente outra foto ou um PDF." }, { status: 400 });
    }

    const key = buildRegistrationDocKey(access.organizationId, contentType);
    await uploadRegistrationDoc(key, stored, contentType);
    try {
      const doc = await prisma.dealRegistrationDocument.create({
        data: {
          organizationId: access.organizationId,
          registrationId: registration.id,
          kind: kind as "PHOTO_ID" | "SOCIAL_CONTRACT" | "OTHER",
          fileName: file.name.slice(0, 160) || "documento",
          contentType: contentType,
          size: stored.length,
          storageKey: key,
          uploadedById: access.userId,
        },
        select: { id: true, kind: true, fileName: true, size: true, createdAt: true },
      });
      return NextResponse.json({ document: doc }, { status: 201 });
    } catch (err) {
      // Sem a linha no banco o arquivo ficaria órfão no R2.
      await deleteRegistrationDoc(key).catch(() => {});
      throw err;
    }
  });
}
