import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Megaphone } from "lucide-react";
import { Prisma } from "@/app/generated/prisma/client";
import { brazilDateKey } from "@/lib/timezone";
import { getServopaTablesAccess } from "@/lib/servopa-tables/access";
import { getServopaCampaignSampleTables, listServopaCampaigns } from "@/lib/servopa-tables/campaigns";
import { CampaignsManager } from "./campaigns-manager";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campanhas das tabelas" };

export default async function ServopaCampaignsPage() {
  const access = await getServopaTablesAccess();
  if (!access.ok) redirect("/login");
  if (!access.canManageCampaigns) redirect("/tabelas");

  // Antes da migração 20261028120000_servopa_campaigns chegar ao banco, a tabela não existe (P2021): aviso em vez de tela de erro.
  const loaded = await Promise.all([
    listServopaCampaigns(access.organizationId),
    getServopaCampaignSampleTables(access.organizationId),
  ]).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") return null;
    throw error;
  });

  return (
    <div className="space-y-5">
      <div>
        <Link href="/tabelas" className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Tabelas
        </Link>
        <div className="mt-2 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand/10 text-brand"><Megaphone className="h-4 w-4" aria-hidden="true" /></div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Campanhas do PDF</h1>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500 dark:text-neutral-400">
          A arte da campanha vira a faixa do topo do PDF das tabelas, só nos dias programados. Fora do período, o PDF sai no modelo normal.
        </p>
      </div>

      {loaded ? (
        <CampaignsManager initialCampaigns={loaded[0]} sampleTables={loaded[1]} today={brazilDateKey()} />
      ) : (
        <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          As campanhas ainda não foram ativadas neste banco de dados. Elas passam a funcionar depois da próxima atualização do CRM.
        </p>
      )}
    </div>
  );
}
