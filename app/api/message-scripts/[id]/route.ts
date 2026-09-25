import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { validateSteps, canAccessScript } from "@/lib/campaigns/scripts";
import { updateScriptAndSync } from "@/lib/campaigns/script-sync";
import { getDealScope } from "@/lib/team-scope";

export const dynamic = "force-dynamic";

// Restrita (PRIVATE): ver canAccessScript em lib/campaigns/scripts.ts — 404
// (não 403) pra não confirmar nem que o script existe, pra quem não tem acesso.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const script = await prisma.messageScript.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!script || !canAccessScript(script, access)) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    return NextResponse.json(script);
  });
}

/**
 * Além de nome/texto/tags/visibilidade, aceita duas decisões de quem edita
 * (ver lib/campaigns/script-sync.ts, que explica o porquê de cada uma):
 *  - `versionMode`: "NEW_VERSION" sobe MessageScript.version (relatório passa
 *    a contar separado); ausente/"FIX" = correção, mesma versão. Só tem
 *    efeito se o TEXTO mudou de fato.
 *  - `applyToCampaignIds`: campanhas ativas (rascunho/rodando/pausada) que
 *    devem receber o texto novo agora. Nunca aplica sozinho.
 * Sem esses campos o comportamento é o de sempre: só grava o script.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, steps, tags, visibility, versionMode, applyToCampaignIds } = body as {
    name?: string;
    steps?: unknown;
    tags?: string[];
    visibility?: string;
    versionMode?: string;
    applyToCampaignIds?: unknown;
  };

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!name?.trim()) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  const validated = validateSteps(steps);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  if (versionMode !== undefined && versionMode !== "FIX" && versionMode !== "NEW_VERSION") {
    return NextResponse.json({ error: "versionMode inválido" }, { status: 400 });
  }
  if (applyToCampaignIds !== undefined && (!Array.isArray(applyToCampaignIds) || applyToCampaignIds.some((c) => typeof c !== "string"))) {
    return NextResponse.json({ error: "applyToCampaignIds inválido" }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    // Escopo por papel — a lista de campanhas que esta edição pode alterar
    // segue a mesma visibilidade de campanha do resto do sistema (um script
    // público compartilhado nunca vira brecha pra mexer na campanha alheia).
    const scope = await getDealScope(access.organizationId, access.userId, access.role);
    const result = await updateScriptAndSync(
      { organizationId: access.organizationId, userId: access.userId, role: access.role, scope },
      id,
      {
        name: name.trim(),
        steps: validated.steps,
        tags: (tags ?? []).map((t) => t.trim()).filter(Boolean),
        visibility: visibility === "PUBLIC" || visibility === "PRIVATE" ? visibility : undefined,
        versionMode: versionMode as "FIX" | "NEW_VERSION" | undefined,
        applyToCampaignIds: applyToCampaignIds as string[] | undefined,
      },
    );
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    return NextResponse.json({
      ...result.script,
      sync: {
        stepsChanged: result.stepsChanged,
        versionBumped: result.versionBumped,
        appliedCampaignIds: result.appliedCampaignIds,
        skippedCampaignIds: result.skippedCampaignIds,
      },
    });
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.messageScript.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!existing || !canAccessScript(existing, access)) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    await prisma.messageScript.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
