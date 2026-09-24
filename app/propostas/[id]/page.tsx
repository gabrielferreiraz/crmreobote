import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentMembership } from "@/lib/current-membership";
import { runWithTenant } from "@/lib/tenant-context";
import { getSharedScope } from "@/lib/share-groups";
import { getProposalPrintData } from "@/lib/proposals/queries";
import { formatProposalNumber } from "@/lib/proposals/types";
import { ProposalDocument } from "@/components/proposals/proposal-document";
import { ProposalToolbar } from "./proposal-toolbar";

export const dynamic = "force-dynamic";

/**
 * Página de impressão da proposta — FORA de (dashboard) de propósito (mesmo
 * desenho de app/tv e app/t/[code]): o layout do dashboard traz menu, cabeçalho
 * e navegação móvel que não fazem parte de um documento e teriam que ser
 * escondidos no @media print; aqui a página já nasce só com a folha.
 *
 * É rota AUTENTICADA (não pública): quem abre é o consultor logado pra
 * imprimir/salvar o PDF — o cliente nunca abre este endereço, só recebe o
 * arquivo depois. Por isso não precisa de nada em PUBLIC_PATHS
 * (lib/auth.config.ts) nem do padrão de "bootstrap por código" que a TV e o
 * Cartão Digital usam. Como não passa pelo layout do dashboard, a checagem de
 * "membro ainda ativo" (que lá derruba sessão de quem foi desativado) precisa
 * ser refeita aqui.
 *
 * PDF sem servidor: window.print() + "Salvar como PDF" do próprio navegador
 * do consultor — nenhum Chromium/Gotenberg na VPS.
 */

type Loaded =
  | { kind: "unauthenticated" }
  | { kind: "inactive" }
  | { kind: "notfound" }
  | { kind: "ok"; data: NonNullable<Awaited<ReturnType<typeof getProposalPrintData>>> };

// cache(): generateMetadata e a página pedem a mesma proposta na mesma
// requisição — sem isto seriam duas idas ao banco.
const load = cache(async (id: string): Promise<Loaded> => {
  const membership = await getCurrentMembership();
  if (!membership) return { kind: "unauthenticated" };
  if (!membership.active) return { kind: "inactive" };

  const data = await runWithTenant(membership.organizationId, async () => {
    const scope = await getSharedScope(membership.organizationId, membership.userId, membership.role, "shareDeals");
    return getProposalPrintData(membership.organizationId, scope, id);
  });
  return data ? { kind: "ok", data } : { kind: "notfound" };
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const loaded = await load(id);
  // O navegador usa o <title> como nome padrão do arquivo ao "Salvar como
  // PDF" — "Proposta 000012 - Fulano" já sai pronto pra mandar pro cliente.
  if (loaded.kind !== "ok") return { title: "Proposta" };
  const { proposal, clientName } = loaded.data;
  return { title: `Proposta ${formatProposalNumber(proposal.number)} - ${clientName}` };
}

export default async function ProposalPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await load(id);

  if (loaded.kind === "unauthenticated") redirect("/login");
  if (loaded.kind === "inactive") redirect("/api/auth/deactivated");
  if (loaded.kind === "notfound") notFound();

  return (
    // bg-neutral-200 explícito (não herda o tema): é a "mesa" em que a folha
    // branca está apoiada na tela; no papel (print:) some tudo isso.
    <div className="min-h-screen overflow-x-auto bg-neutral-200 px-4 py-6 print:min-h-0 print:bg-white print:p-0">
      <ProposalToolbar proposal={loaded.data.proposal} />
      <ProposalDocument data={loaded.data} />
    </div>
  );
}
