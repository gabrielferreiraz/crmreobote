import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@/app/generated/prisma/client";

type TenantStore = { organizationId?: string; userId?: string; instanceName?: string };

// Guardado em globalThis pelo mesmo motivo do client do Prisma em lib/prisma.ts:
// o Next.js pode empacotar este módulo mais de uma vez em contextos diferentes
// (Server Components vs Route Handlers) durante o dev. Sem isso, `storage.run()`
// chamado a partir de uma cópia do módulo não é visto por quem lê o contexto a
// partir de outra cópia — cada uma teria seu próprio AsyncLocalStorage isolado.
const globalForTenant = globalThis as unknown as { tenantStorage?: AsyncLocalStorage<TenantStore> };

const storage = globalForTenant.tenantStorage ?? new AsyncLocalStorage<TenantStore>();

if (process.env.NODE_ENV !== "production") globalForTenant.tenantStorage = storage;

export function getCurrentOrganizationId(): string | undefined {
  return storage.getStore()?.organizationId;
}

export function getCurrentUserId(): string | undefined {
  return storage.getStore()?.userId;
}

export function getCurrentInstanceName(): string | undefined {
  return storage.getStore()?.instanceName;
}

/**
 * O `await fn()` aqui dentro (em vez de só `storage.run({...}, fn)`) é
 * proposital, não redundante: as Promises que o Prisma retorna são preguiçosas
 * — só disparam o extends/$allOperations (ver lib/prisma.ts) quando alguém dá
 * `.then()`/`await` nelas. Se o callback do chamador for uma arrow síncrona que
 * só *retorna* essa promise sem dar await (ex.: `() => prisma.x.findFirst(...)`),
 * `storage.run()` já devolveu antes da consulta rodar de fato — o `.then()`
 * acontece depois, fora da janela em que o AsyncLocalStorage está ativo, e
 * `getCurrentOrganizationId()`/`getCurrentUserId()` voltam undefined bem no
 * meio da operação (RLS filtra tudo em silêncio, sem erro). Dar await aqui
 * dentro garante que a consulta é resolvida como continuação da própria
 * ativação async criada por `storage.run()`, então o contexto é visto não
 * importa como o chamador escreveu o callback.
 */
export function runWithTenant<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ organizationId }, async () => await fn());
}

/**
 * Mesma ideia de `runWithTenant`, mas pro momento do login (lib/auth.ts): só o
 * userId é conhecido ainda, não o organizationId — é literalmente o que a
 * consulta dentro de `fn` está descobrindo. A policy de RLS de OrganizationUser
 * permite ver a própria filiação por userId, mesmo sem organizationId definido.
 */
export function runWithTenantUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ userId }, async () => await fn());
}

/**
 * Mesma ideia, mas pro webhook do Evolution API (lib/whatsapp/webhook.ts):
 * a requisição só traz o `instanceName`, o organizationId ainda precisa ser
 * descoberto a partir dele. A policy de RLS de WhatsAppInstance permite achar
 * a própria linha por instanceName, mesmo sem organizationId definido — igual
 * ao OrganizationUser permite achar a própria filiação por userId no login.
 */
export function runWithInstanceLookup<T>(instanceName: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ instanceName }, async () => await fn());
}

/**
 * Só necessário dentro de `prismaRaw.$transaction(async (tx) => ...)` (transação
 * interativa) — o cliente `tx` ali é o cliente "cru" (sem a extensão de RLS, pra
 * evitar transação aninhada), então o SET LOCAL precisa ser feito manualmente
 * como primeiro passo. Fora de uma transação interativa, a extensão em
 * lib/prisma.ts já faz isso sozinha para cada operação.
 */
export async function setTenantOnTx(tx: Prisma.TransactionClient, organizationId: string) {
  await tx.$executeRaw`SELECT set_config('app.current_organization_id', ${organizationId}, true)`;
}
