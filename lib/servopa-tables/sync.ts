/**
 * Entrada de produção da sincronização das tabelas Servopa. O motor fica em
 * sync-engine.ts para poder ser validado com banco em memória nos testes.
 */

import { prismaRaw } from "@/lib/prisma";
import {
  syncServopaSnapshotWithDependencies,
  type SyncOptions,
  type SyncSummary,
} from "@/lib/servopa-tables/sync-engine";
import { setTenantOnTx } from "@/lib/tenant-context";

export type { SyncCounts, SyncOptions, SyncSummary } from "@/lib/servopa-tables/sync-engine";

export async function syncServopaSnapshot(opts: SyncOptions): Promise<{ runId: string; summary: SyncSummary }> {
  return syncServopaSnapshotWithDependencies(opts, {
    transaction: (callback, options) => prismaRaw.$transaction(callback, options),
    setTenant: setTenantOnTx,
  });
}
