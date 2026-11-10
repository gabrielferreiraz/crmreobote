import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { filtersFromParams, listAuditActors, queryAudit } from "@/lib/audit-query";
import { AuditLogView } from "./audit-log-view";

export const dynamic = "force-dynamic";

export default async function AuditoriaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  if (session?.user.role !== "OWNER") redirect("/configuracoes");

  const organizationId = session.user.organizationId!;
  // Links como "ver tudo deste item" chegam aqui com os filtros na URL.
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value) params.set(k, value);
  }
  const filters = filtersFromParams(params);

  const [initial, actors] = await Promise.all([queryAudit(organizationId, filters), listAuditActors(organizationId)]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Auditoria</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Quem fez, quando e o que mudou: acessos, equipe e permissões, negócios, cadastro e cota, comissões, integrações e exportações.
          O registro é somente de inclusão: nenhum evento pode ser alterado nem apagado. Visível só para donos.
        </p>
      </div>

      <AuditLogView initial={initial} actors={actors} initialFilters={filters} />
    </div>
  );
}
