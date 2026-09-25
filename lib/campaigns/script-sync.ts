import { prisma, prismaRaw } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import type { $Enums } from "@/app/generated/prisma/client";
import { setTenantOnTx } from "@/lib/tenant-context";
import { campaignScopeWhere, type DealScope } from "@/lib/team-scope";
import { canAccessScript } from "@/lib/campaigns/scripts";
import type { ScriptStep } from "@/lib/campaigns/spintax";
import { normalizeSteps } from "@/lib/campaigns/script-steps";

// Reexporta: quem já importava daqui (list.ts) continua funcionando; a versão
// pura (sem prisma) mora em script-steps.ts pra o navegador também usar.
export { normalizeSteps };

/**
 * Edição de script COM efeito nas campanhas em andamento + versão de medição.
 *
 * Contexto: a campanha guarda uma CÓPIA congelada do texto dos scripts
 * (Campaign.messageTemplates / followUpTemplates / rmktWaves[].templates —
 * ver comentário em schema.prisma). Antes, editar o script na biblioteca
 * nunca chegava numa campanha já criada, e a campanha só era editável em
 * rascunho. Agora o texto pode ser REESCRITO nessas cópias — o motor
 * (lib/campaigns/engine.ts) relê a linha da campanha a cada envio, então o
 * texto novo vale já no próximo destinatário, sem mexer no motor.
 *
 * Duas decisões de quem edita, tomadas na hora de salvar (ver
 * components/… script-save-dialog.tsx):
 *  1. "correção" x "nova versão": só nova versão sobe MessageScript.version.
 *     Cada envio grava a versão da cópia que usou (scriptVersion), então o
 *     relatório separa "Script · v1" de "Script · v2" — e uma correção de
 *     digitação continua somando no mesmo número.
 *  2. Em quais campanhas ativas aplicar. Nunca aplica sozinho: um script
 *     PÚBLICO pode estar rodando com leads de verdade em campanha de outra
 *     pessoa; mudar o que é enviado sem a pessoa decidir seria pior que o
 *     problema que isto resolve.
 *
 * Só campanhas DRAFT/RUNNING/PAUSED e só as que o usuário enxerga (mesmo
 * escopo por criador de campaignScopeWhere — script público compartilhado não
 * pode virar um jeito de mexer na campanha alheia). DONE fica intacta: é
 * registro histórico e não vai mais enviar nada.
 */

export const ACTIVE_CAMPAIGN_STATUSES: $Enums.CampaignStatus[] = ["DRAFT", "RUNNING", "PAUSED"];

export type ScriptSnapshotSource = { id: string; steps: unknown; version: number };

type TemplateFields = { messageTemplates: unknown; followUpTemplates: unknown; rmktWaves: unknown };

function rewriteList(list: unknown, script: ScriptSnapshotSource): { value: unknown; changed: number } {
  if (!Array.isArray(list)) return { value: list, changed: 0 };
  let changed = 0;
  const value = list.map((entry) => {
    if (!entry || typeof entry !== "object" || (entry as { scriptId?: string }).scriptId !== script.id) return entry;
    changed += 1;
    return { ...(entry as object), steps: script.steps, scriptVersion: script.version };
  });
  return { value, changed };
}

/**
 * Reescreve, nas TRÊS cópias de uma campanha (envio inicial, reenvio e ondas
 * de RMKT), toda entrada que aponta pro script — texto novo + versão nova.
 * Pura: não toca no banco.
 */
export function rewriteCampaignTemplates(campaign: TemplateFields, script: ScriptSnapshotSource) {
  const initial = rewriteList(campaign.messageTemplates, script);
  const followUp = rewriteList(campaign.followUpTemplates, script);

  let rmktWaves = campaign.rmktWaves;
  let waveChanged = 0;
  if (Array.isArray(campaign.rmktWaves)) {
    rmktWaves = campaign.rmktWaves.map((wave) => {
      if (!wave || typeof wave !== "object") return wave;
      const r = rewriteList((wave as { templates?: unknown }).templates, script);
      waveChanged += r.changed;
      return { ...(wave as object), templates: r.value };
    });
  }

  return {
    messageTemplates: initial.value,
    followUpTemplates: followUp.value,
    rmktWaves,
    changed: initial.changed + followUp.changed + waveChanged,
  };
}

export type CampaignScriptEntry = {
  scriptId: string;
  kind: "initial" | "followUp" | "wave";
  /** Só pra kind "wave": índice (0-based) da onda e o dia em que sai. */
  waveIndex?: number;
  waveDayOffset?: number;
  weight: number;
  steps: unknown;
  scriptVersion: number | null;
};

/** Todas as entradas de script de uma campanha, achatadas — usada pela lista de "quem usa" e pelo painel da campanha. */
export function listCampaignScriptEntries(campaign: TemplateFields): CampaignScriptEntry[] {
  const out: CampaignScriptEntry[] = [];
  const push = (list: unknown, base: Omit<CampaignScriptEntry, "scriptId" | "weight" | "steps" | "scriptVersion">) => {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      const e = (raw ?? {}) as { scriptId?: string; weight?: number; steps?: unknown; scriptVersion?: number };
      if (!e.scriptId) continue;
      out.push({ ...base, scriptId: e.scriptId, weight: Number(e.weight) || 0, steps: e.steps, scriptVersion: e.scriptVersion ?? null });
    }
  };
  push(campaign.messageTemplates, { kind: "initial" });
  push(campaign.followUpTemplates, { kind: "followUp" });
  if (Array.isArray(campaign.rmktWaves)) {
    campaign.rmktWaves.forEach((wave, waveIndex) => {
      const w = (wave ?? {}) as { dayOffset?: number; templates?: unknown };
      push(w.templates, { kind: "wave", waveIndex, waveDayOffset: w.dayOffset });
    });
  }
  return out;
}

function campaignUsesScript(campaign: TemplateFields, scriptId: string): boolean {
  return listCampaignScriptEntries(campaign).some((e) => e.scriptId === scriptId);
}

const CAMPAIGN_TEMPLATE_SELECT = {
  id: true,
  name: true,
  status: true,
  messageTemplates: true,
  followUpTemplates: true,
  rmktWaves: true,
} as const;

// ─── Impacto (alimenta o diálogo de salvar) ─────────────────────────────

export type ScriptImpact = {
  version: number;
  /** O script já foi de fato enviado a alguém — só então "nova versão" muda alguma coisa nos relatórios. */
  hasHistory: boolean;
  campaigns: { id: string; name: string; status: $Enums.CampaignStatus; pendingCount: number }[];
};

/** Chamar dentro de runWithTenant. Só enxerga campanhas do escopo de quem pede. */
export async function getScriptImpact(organizationId: string, scope: DealScope, scriptId: string, version: number): Promise<ScriptImpact> {
  const [used, sentWithIt] = await Promise.all([
    prisma.campaign.findMany({
      where: { organizationId, status: { in: ACTIVE_CAMPAIGN_STATUSES }, ...campaignScopeWhere(scope) },
      select: CAMPAIGN_TEMPLATE_SELECT,
      orderBy: { createdAt: "desc" },
    }),
    // findFirst (não count): pára no 1º achado; CampaignRecipient não tem
    // índice por scriptId e isto roda uma vez por edição, não por carga de tela.
    prisma.campaignRecipient.findFirst({
      where: { campaign: { organizationId }, OR: [{ scriptId }, { followUpScriptId: scriptId }] },
      select: { id: true },
    }),
  ]);

  const campaigns = used.filter((c) => campaignUsesScript(c, scriptId));
  const pending = campaigns.length
    ? await prisma.campaignRecipient.groupBy({
        by: ["campaignId"],
        where: { campaignId: { in: campaigns.map((c) => c.id) }, status: "PENDING" },
        _count: true,
      })
    : [];
  const pendingById = new Map(pending.map((p) => [p.campaignId, p._count]));

  return {
    version,
    hasHistory: !!sentWithIt,
    campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status, pendingCount: pendingById.get(c.id) ?? 0 })),
  };
}

// ─── Atualizar script + aplicar nas campanhas escolhidas (transação única) ───

export type ScriptUpdateActor = { organizationId: string; userId: string; role: string; scope: DealScope };

export type ScriptUpdateInput = {
  name: string;
  steps: ScriptStep[];
  tags: string[];
  visibility?: "PUBLIC" | "PRIVATE";
  /** Só vale se o texto mudou de fato; ausente = "FIX" (correção, comportamento de sempre). */
  versionMode?: "FIX" | "NEW_VERSION";
  applyToCampaignIds?: string[];
};

export type ScriptUpdateResult =
  | {
      ok: true;
      script: Prisma.MessageScriptGetPayload<object>;
      stepsChanged: boolean;
      versionBumped: boolean;
      appliedCampaignIds: string[];
      /** Pedidas mas ignoradas (fora do escopo, encerradas ou que não usam o script). */
      skippedCampaignIds: string[];
    }
  | { ok: false; status: 404; error: string };

/**
 * prismaRaw.$transaction com CALLBACK (a forma em array não é atômica neste
 * setup — ver lib/proposals/service.ts): script + versão + todas as
 * campanhas escolhidas mudam juntos ou nenhuma muda. Um script com versão
 * nova mas campanhas ainda no texto velho (ou o contrário) seria exatamente
 * o meio-estado que faz o relatório atribuir envio à versão errada.
 */
export async function updateScriptAndSync(actor: ScriptUpdateActor, scriptId: string, input: ScriptUpdateInput): Promise<ScriptUpdateResult> {
  return prismaRaw.$transaction(
    async (tx) => {
      await setTenantOnTx(tx, actor.organizationId);

      const existing = await tx.messageScript.findFirst({ where: { id: scriptId, organizationId: actor.organizationId } });
      if (!existing || !canAccessScript(existing, actor)) return { ok: false as const, status: 404 as const, error: "Não encontrado" };

      const stepsChanged = normalizeSteps(existing.steps) !== normalizeSteps(input.steps);
      const bump = stepsChanged && input.versionMode === "NEW_VERSION";
      const nextVersion = bump ? existing.version + 1 : existing.version;

      const history = Array.isArray(existing.versionHistory) ? [...(existing.versionHistory as unknown[])] : [];
      if (bump) {
        history.push({
          version: existing.version,
          name: existing.name,
          steps: existing.steps,
          savedAt: new Date().toISOString(),
          savedById: actor.userId,
        });
      }

      const script = await tx.messageScript.update({
        where: { id: scriptId },
        data: {
          name: input.name,
          steps: input.steps as unknown as Prisma.InputJsonValue,
          tags: input.tags,
          ...(input.visibility ? { visibility: input.visibility } : {}),
          ...(bump ? { version: nextVersion, versionHistory: history as unknown as Prisma.InputJsonValue } : {}),
        },
      });

      const appliedCampaignIds: string[] = [];
      const requested = Array.from(new Set(input.applyToCampaignIds ?? []));
      if (stepsChanged && requested.length > 0) {
        const campaigns = await tx.campaign.findMany({
          where: {
            id: { in: requested },
            organizationId: actor.organizationId,
            status: { in: ACTIVE_CAMPAIGN_STATUSES },
            ...campaignScopeWhere(actor.scope),
          },
          select: CAMPAIGN_TEMPLATE_SELECT,
        });
        for (const c of campaigns) {
          const rewritten = rewriteCampaignTemplates(c, { id: script.id, steps: script.steps, version: script.version });
          if (rewritten.changed === 0) continue;
          await tx.campaign.update({
            where: { id: c.id },
            data: {
              messageTemplates: rewritten.messageTemplates as Prisma.InputJsonValue,
              // Só reescreve o que existe — null continua null (Prisma.DbNull
              // seria trocar "ausente" por "JSON null", coisa diferente).
              ...(c.followUpTemplates != null ? { followUpTemplates: rewritten.followUpTemplates as Prisma.InputJsonValue } : {}),
              ...(c.rmktWaves != null ? { rmktWaves: rewritten.rmktWaves as Prisma.InputJsonValue } : {}),
            },
          });
          appliedCampaignIds.push(c.id);
        }
      }

      return {
        ok: true as const,
        script,
        stepsChanged,
        versionBumped: bump,
        appliedCampaignIds,
        skippedCampaignIds: requested.filter((id) => !appliedCampaignIds.includes(id)),
      };
    },
    { timeout: 20_000 },
  );
}

// ─── "Usar a versão da biblioteca" (puxar) numa campanha específica ──────

export type SyncCampaignResult =
  | { ok: true; syncedScriptIds: string[]; skippedScriptIds: string[] }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Caminho inverso: a pessoa editou o script na biblioteca e NÃO aplicou nesta
 * campanha na hora (ou a edição foi de outro consultor) — depois decide puxar.
 * Copia texto + versão ATUAIS da biblioteca pra cópia da campanha. `scriptId`
 * ausente = todos os scripts da campanha que estão diferentes da biblioteca.
 */
export async function syncCampaignFromLibrary(
  actor: ScriptUpdateActor,
  campaignId: string,
  scriptId?: string,
): Promise<SyncCampaignResult> {
  return prismaRaw.$transaction(
    async (tx) => {
      await setTenantOnTx(tx, actor.organizationId);

      const campaign = await tx.campaign.findFirst({
        where: { id: campaignId, organizationId: actor.organizationId, ...campaignScopeWhere(actor.scope) },
        select: CAMPAIGN_TEMPLATE_SELECT,
      });
      if (!campaign) return { ok: false as const, status: 404 as const, error: "Não encontrada" };
      if (!ACTIVE_CAMPAIGN_STATUSES.includes(campaign.status)) {
        return { ok: false as const, status: 400 as const, error: "Campanha encerrada não recebe alteração de script" };
      }

      const entries = listCampaignScriptEntries(campaign);
      const wantedIds = Array.from(new Set(entries.map((e) => e.scriptId))).filter((id) => !scriptId || id === scriptId);
      if (scriptId && wantedIds.length === 0) {
        return { ok: false as const, status: 400 as const, error: "Este script não é usado nesta campanha" };
      }

      const library = await tx.messageScript.findMany({
        where: { id: { in: wantedIds }, organizationId: actor.organizationId },
      });
      const libraryById = new Map(library.map((s) => [s.id, s]));

      let current: TemplateFields = campaign;
      const synced: string[] = [];
      const skipped: string[] = [];
      for (const id of wantedIds) {
        const lib = libraryById.get(id);
        // Removido da biblioteca ou Restrito de outra pessoa: mantém a cópia como está.
        if (!lib || !canAccessScript(lib, actor)) {
          skipped.push(id);
          continue;
        }
        const versionDiffers = entries.some((e) => e.scriptId === id && (e.scriptVersion ?? 1) !== lib.version);
        const textDiffers = entries.some((e) => e.scriptId === id && normalizeSteps(e.steps) !== normalizeSteps(lib.steps));
        if (!versionDiffers && !textDiffers) continue; // já igual — nada a fazer
        const r = rewriteCampaignTemplates(current, { id: lib.id, steps: lib.steps, version: lib.version });
        current = { messageTemplates: r.messageTemplates, followUpTemplates: r.followUpTemplates, rmktWaves: r.rmktWaves };
        synced.push(id);
      }

      if (synced.length > 0) {
        await tx.campaign.update({
          where: { id: campaign.id },
          data: {
            messageTemplates: current.messageTemplates as Prisma.InputJsonValue,
            ...(campaign.followUpTemplates != null ? { followUpTemplates: current.followUpTemplates as Prisma.InputJsonValue } : {}),
            ...(campaign.rmktWaves != null ? { rmktWaves: current.rmktWaves as Prisma.InputJsonValue } : {}),
          },
        });
      }
      return { ok: true as const, syncedScriptIds: synced, skippedScriptIds: skipped };
    },
    { timeout: 20_000 },
  );
}
