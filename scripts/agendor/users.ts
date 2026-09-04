/**
 * Resolução de usuário do Agendor → User daqui, pras 3 fases de importação
 * (pessoas/negócios/tarefas). Dois casos:
 *
 * 1. Consultor ATIVO (lista fixa abaixo, levantada em conversa com o
 *    usuário) — ganha um User de verdade, com senha temporária (mesmo
 *    padrão de app/api/org/members/route.ts) impressa no console pra ser
 *    repassada.
 * 2. Qualquer outro nome/username que apareça nos arquivos — vira um User
 *    DESATIVADO (`OrganizationUser.active: false`, sem senha) só pra
 *    preservar de quem era o negócio/tarefa historicamente, sem dar acesso
 *    de login. E-mail sintético determinístico (`{slug}@agendor-inativo.local`)
 *    — reimportar depois encontra o MESMO usuário em vez de criar de novo
 *    (mesma lógica de idempotência do resto do script, aqui via
 *    User.email @unique em vez de um campo agendorXId).
 *
 * Alguns nomes no Agendor aparecem como usuário.sobrenome, outros como nome
 * completo (ex.: "Reobote Consórcios", "Felipe Kling") — o mapa de ativos
 * cobre as duas formas vistas nos dados reais pra cada pessoa.
 */

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { generateTempPassword } from "@/lib/generate-temp-password";

export const ORGANIZATION_ID = "cmr9i96330001ekvpb3b4o4nn";

type ActiveConsultant = { names: string[]; realName: string; email: string; role: "OWNER" | "MANAGER" | "SUPERVISOR" | "MEMBER" };

// Confirmado em conversa com o usuário — as duas grafias vistas nos 4
// arquivos (username com ponto E, quando existe, o nome completo de exibição)
// apontam pra mesma pessoa.
const ACTIVE_CONSULTANTS: ActiveConsultant[] = [
  { names: ["vinicius.campos"], realName: "Vinicius Campos", email: "vinicius.campos@reoboteconsorcios.com.br", role: "MEMBER" },
  { names: ["patricia.soares"], realName: "Patricia Soares", email: "patricia.soares@reoboteconsorcios.com.br", role: "MEMBER" },
  { names: ["carlos.olivas"], realName: "Carlos Olivas", email: "carlos.olivas@reoboteconsorcios.com.br", role: "MEMBER" },
  { names: ["santarosa"], realName: "Santa Rosa", email: "santarosa@reoboteconsorcios.com.br", role: "MEMBER" },
  { names: ["murilo.silva"], realName: "Murilo Silva", email: "murilo.silva@reoboteconsorcios.com.br", role: "MEMBER" },
  { names: ["kassio.gomes"], realName: "Kassio Gomes", email: "kassio.gomes@reoboteconsorcios.com.br", role: "MEMBER" },
  { names: ["auriflavio.pinheiro", "Flávio Pinheiro", "Flavio Pinheiro"], realName: "Flávio Pinheiro", email: "auriflavio.pinheiro@reoboteconsorcios.com.br", role: "MEMBER" },
  { names: ["karen.landgraf"], realName: "Karen Landgraf", email: "karen.landgraf@reoboteconsorcios.com.br", role: "MEMBER" },
  { names: ["raphael.lucas"], realName: "Raphael Lucas", email: "raphaellucas@reoboteconsorcios.com.br", role: "MEMBER" },
  { names: ["eduardo.fujiyama"], realName: "Eduardo Fujiyama", email: "edufujiyama@reoboteconsorcios.com.br", role: "MEMBER" },
  // Achado na migração de 03/09: "claudio.ribas" já tinha virado usuário
  // INATIVO sintético numa migração anterior (email @agendor-inativo.local)
  // antes de se saber que ele tem conta de verdade — Gerente, ativo, com
  // login próprio. Confirmado em conversa com o usuário. names[] usa a
  // grafia SEM acento do Agendor ("claudio.ribas") + a grafia COM acento do
  // nome de exibição real ("Cláudio Ribas") — resolveUserId normaliza só
  // por trim+lowercase, não remove acento, então as duas formas precisam
  // estar aqui pra cobrir onde cada uma aparece nos arquivos.
  { names: ["claudio.ribas", "Cláudio Ribas", "Claudio Ribas"], realName: "Cláudio Ribas", email: "claudio.ribas@reoboteconsorcios.com.br", role: "MANAGER" },
  // Dono de verdade do negócio (Agendor: "Administrador"/"Dono") — pessoa
  // diferente do Gabriel (TI, já mantido no reset como OWNER técnico).
  { names: ["Reobote Consórcios", "mrenan"], realName: "Renan", email: "mrenan@reoboteconsorcios.com.br", role: "OWNER" },
  // Achados na revisão do --force-sync de 03/09: mesmo padrão do Cláudio
  // Ribas acima — essas 4 pessoas já tinham conta REAL e ativa no CRM, mas
  // como não estavam nesta lista, toda menção a elas nos arquivos do
  // Agendor foi parar numa conta fantasma paralela (@agendor-inativo.local)
  // em vez da conta real — Deal/Task/Contact/Activity ficaram presos no
  // fantasma. Migrados de volta pra conta real por scripts/fix-ghost-consultants.ts.
  { names: ["mariana.ribeiro"], realName: "Mariana Ribeiro", email: "mariana.ribeiro@reoboteconsorcios.com.br", role: "SUPERVISOR" },
  { names: ["wander.luis"], realName: "Wander Luis", email: "wander.luis@reoboteconsorcios.com.br", role: "MEMBER" },
  { names: ["joao.vitor"], realName: "João Vitor", email: "joao.vitor@reoboteconsorcios.com.br", role: "MEMBER" },
  { names: ["Lucas Cáceres"], realName: "Lucas Cáceres", email: "lucas.caceres@reoboteconsorcios.com.br", role: "MEMBER" },
];

const activeByName = new Map<string, ActiveConsultant>();
for (const c of ACTIVE_CONSULTANTS) {
  for (const n of c.names) activeByName.set(normalizeKey(n), c);
}

function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase();
}

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

// agendor name (normalizado) -> Promise<User.id>, memoizado nesta execução.
// Guarda a PROMISE (não só o valor final) de propósito: com processamento
// concorrente, duas linhas podem pedir o mesmo nome novo ao mesmo tempo —
// se guardássemos só o valor resolvido, as duas veriam cache vazio e cada
// uma tentaria criar o mesmo usuário inativo, e a segunda apanharia um
// unique-constraint no e-mail. Guardando a promise em voo, a segunda
// chamada só espera a mesma promise em vez de duplicar o create.
const resolvedCache = new Map<string, Promise<string | null>>();

function cacheAllVariants(c: ActiveConsultant, userId: string): void {
  for (const n of c.names) resolvedCache.set(normalizeKey(n), Promise.resolve(userId));
}

/** Cria (se ainda não existir) os ~11 consultores ativos + Renan. Roda uma vez, no início do script. Sempre popula o cache (inclusive em dry-run, com um id falso) — resolveUserId nunca deveria precisar buscar um consultor ativo no banco de novo. */
export async function ensureActiveConsultants(dryRun: boolean): Promise<void> {
  for (const c of ACTIVE_CONSULTANTS) {
    const existing = await prisma.user.findUnique({ where: { email: c.email } });
    if (existing) {
      cacheAllVariants(c, existing.id);
      console.log(`[users] já existe: ${c.realName} <${c.email}>`);
      continue;
    }
    if (dryRun) {
      cacheAllVariants(c, `dry-run:${c.email}`);
      console.log(`[users] (dry-run) criaria: ${c.realName} <${c.email}> role=${c.role}`);
      continue;
    }
    const tempPassword = generateTempPassword();
    const hashed = await bcrypt.hash(tempPassword, 10);
    const user = await prisma.user.create({ data: { name: c.realName, email: c.email, password: hashed } });
    await prisma.organizationUser.create({
      data: { organizationId: ORGANIZATION_ID, userId: user.id, role: c.role, active: true },
    });
    cacheAllVariants(c, user.id);
    console.log(`[users] criado: ${c.realName} <${c.email}> role=${c.role} — senha temporária: ${tempPassword}`);
  }
}

/**
 * Resolve qualquer nome/username visto nos arquivos do Agendor pro
 * User.id daqui — ativo (mapa fixo) ou desativado (cria sob demanda, com
 * e-mail sintético determinístico pra idempotência entre execuções).
 */
export async function resolveUserId(agendorName: string | null | undefined, dryRun: boolean): Promise<string | null> {
  if (!agendorName || !agendorName.trim()) return null;
  const key = normalizeKey(agendorName);

  const cached = resolvedCache.get(key);
  if (cached) return cached;

  // Popula o cache com a PROMISE antes de qualquer await — qualquer chamada
  // concorrente que chegue enquanto isso ainda está resolvendo encontra essa
  // mesma promise em vez de disparar sua própria resolução duplicada.
  const promise = resolveUserIdUncached(agendorName, key, dryRun);
  resolvedCache.set(key, promise);
  try {
    return await promise;
  } catch (err) {
    resolvedCache.delete(key); // não trava permanentemente por causa de um erro pontual
    throw err;
  }
}

async function resolveUserIdUncached(agendorName: string, key: string, dryRun: boolean): Promise<string | null> {
  // Não deveria acontecer — ensureActiveConsultants já popula o cache pra
  // TODAS as variantes de nome de todo consultor ativo antes de qualquer
  // chamada a esta função. Se cair aqui mesmo assim (nome com grafia nova
  // não prevista em ACTIVE_CONSULTANTS.names), busca no banco só fora do
  // dry-run — em dry-run o usuário pode nem existir ainda.
  const active = activeByName.get(key);
  if (active) {
    if (dryRun) return `dry-run:${active.email}`;
    const user = await prisma.user.findUniqueOrThrow({ where: { email: active.email } });
    return user.id;
  }

  const syntheticEmail = `${slugify(agendorName)}@agendor-inativo.local`;
  const existing = await prisma.user.findUnique({ where: { email: syntheticEmail } });
  if (existing) return existing.id;

  if (dryRun) return `dry-run:${syntheticEmail}`;

  try {
    const user = await prisma.user.create({ data: { name: agendorName.trim(), email: syntheticEmail, password: null } });
    await prisma.organizationUser.create({
      data: { organizationId: ORGANIZATION_ID, userId: user.id, role: "MEMBER", active: false },
    });
    console.log(`[users] usuário inativo criado: "${agendorName.trim()}" <${syntheticEmail}>`);
    return user.id;
  } catch (err) {
    // Corrida rara: duas grafias diferentes (chaves de cache diferentes)
    // que caem no mesmo e-mail sintético via slugify, resolvidas ao mesmo
    // tempo — a segunda perde a corrida do unique constraint, então busca
    // quem a primeira acabou de criar em vez de propagar o erro.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return (await prisma.user.findUniqueOrThrow({ where: { email: syntheticEmail } })).id;
    }
    throw err;
  }
}
