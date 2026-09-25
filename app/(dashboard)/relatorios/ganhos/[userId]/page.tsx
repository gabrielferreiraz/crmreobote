import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope } from "@/lib/team-scope";
import { resolveAvatarUrl } from "@/lib/r2";
import { formatCurrency } from "@/lib/format";
import { buildQuickRanges } from "@/lib/date-ranges";
import { brazilDateStringToUTC, brazilEndOfDayUTC } from "@/lib/timezone";
import { fetchWonDeals, ownerInScope } from "@/lib/reports/won-deals";
import { Avatar } from "@/components/avatar";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const QUICK_RANGES = buildQuickRanges();
const PERIOD_OPTIONS = [{ key: "all", label: "Todo o histórico" }, ...QUICK_RANGES.map((q) => ({ key: q.key, label: q.label }))];

function formatDay(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Campo_Grande" });
}

/** Monta o link mantendo os outros filtros — cada chip só troca o próprio parâmetro (e volta pra página 1). */
function buildHref(
  userId: string,
  current: { periodo: string; funil: string },
  patch: Partial<{ periodo: string; funil: string; pagina: number }>,
) {
  const next = { ...current, ...patch };
  const params = new URLSearchParams();
  if (next.periodo && next.periodo !== "all") params.set("periodo", next.periodo);
  if (next.funil) params.set("funil", next.funil);
  const pagina = patch.pagina ?? 1;
  if (pagina > 1) params.set("pagina", String(pagina));
  const qs = params.toString();
  return `/relatorios/ganhos/${userId}${qs ? `?${qs}` : ""}`;
}

/**
 * Todos os negócios GANHOS de uma pessoa — destino do "Ver todos os ganhos"
 * do painel "Ver negócios" no ranking do relatório (ver
 * relatorios/won-deals-button.tsx). Diferente do painel (só o período do
 * relatório), aqui o padrão é o histórico INTEIRO e todos os funis: os ganhos
 * de uma pessoa se espalham por vários funis, e o Pipeline mostra um funil de
 * cada vez — por isso esta página existe em vez de só linkar pra lá.
 */
export default async function GanhosPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ periodo?: string; funil?: string; pagina?: string }>;
}) {
  const { userId: ownerId } = await params;
  const sp = await searchParams;

  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const periodo = PERIOD_OPTIONS.some((o) => o.key === sp.periodo) ? (sp.periodo as string) : "all";
  const pagina = Math.max(1, Math.floor(Number(sp.pagina)) || 1);

  const quick = QUICK_RANGES.find((q) => q.key === periodo);
  const range = quick ? quick.range() : null;
  const from = range ? brazilDateStringToUTC(range.from) : null;
  const to = range ? brazilEndOfDayUTC(range.to) : null;

  return runWithTenant(organizationId, async () => {
    const [scope, member, pipelines, byPipeline] = await Promise.all([
      getDealScope(organizationId, session!.user.id, session!.user.role),
      prisma.organizationUser.findFirst({
        where: { organizationId, userId: ownerId },
        select: { active: true, user: { select: { name: true, image: true } } },
      }),
      prisma.pipeline.findMany({ where: { organizationId }, orderBy: { order: "asc" }, select: { id: true, name: true } }),
      // Ganhos por funil NO PERÍODO (sem o filtro de funil) — alimenta os
      // chips de funil com a contagem de cada um.
      prisma.deal.groupBy({
        by: ["pipelineId"],
        where: {
          organizationId,
          status: "WON",
          ownerId,
          ...(from || to ? { closedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        },
        _count: true,
      }),
    ]);

    // Fora do escopo do papel de quem pede (Gerente/Supervisor só enxergam o
    // próprio time, Consultor só a si) ou pessoa que nem existe aqui → 404,
    // nunca uma página "vazia" que pareça "não fechou nada".
    if (!member || !ownerInScope(scope, ownerId)) notFound();

    const pipelineNameById = new Map(pipelines.map((p) => [p.id, p.name]));
    const funnelChips = byPipeline
      .map((g) => ({ id: g.pipelineId, name: pipelineNameById.get(g.pipelineId) ?? "Funil", count: g._count }))
      .sort((a, b) => b.count - a.count);
    const funil = funnelChips.some((c) => c.id === sp.funil) ? (sp.funil as string) : "";

    const result = await fetchWonDeals({
      organizationId,
      scope,
      ownerId,
      from,
      to,
      pipelineId: funil || null,
      skip: (pagina - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });
    if (!result) notFound();

    const photoUrl = await resolveAvatarUrl(member.user.image);
    const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
    const avg = result.total > 0 ? result.sumValue / result.total : 0;
    const current = { periodo, funil };
    const chip = (active: boolean) =>
      `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
          : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`;

    return (
      <div className="space-y-6 pb-8">
        <div>
          <Link
            href="/relatorios"
            className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            Relatórios
          </Link>
          <div className="mt-3 flex items-center gap-4">
            <Avatar name={member.user.name} src={photoUrl} size="xl" className="shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-neutral-400 uppercase dark:text-neutral-500">
                Negócios ganhos
              </p>
              <h1 className="truncate text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                {member.user.name}
                {!member.active && (
                  <span className="ml-2 align-middle text-xs font-medium text-neutral-400 dark:text-neutral-500">(inativo)</span>
                )}
              </h1>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi
            label="Total ganho"
            value={formatCurrency(result.sumValue)}
            subValue={
              result.sumGrossValue > 0 && result.sumGrossValue !== result.sumValue
                ? `bruto: ${formatCurrency(result.sumGrossValue)}`
                : null
            }
          />
          <Kpi label="Negócios fechados" value={String(result.total)} />
          <Kpi label="Ticket médio" value={result.total > 0 ? formatCurrency(avg) : "—"} />
          <Kpi
            label="Primeiro → último"
            value={result.firstClosedAt ? `${formatDay(result.firstClosedAt)} → ${formatDay(result.lastClosedAt)}` : "—"}
            small
          />
        </div>

        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">Período</span>
            {PERIOD_OPTIONS.map((o) => (
              <Link key={o.key} href={buildHref(ownerId, current, { periodo: o.key })} className={chip(periodo === o.key)}>
                {o.label}
              </Link>
            ))}
          </div>
          {funnelChips.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">Funil</span>
              <Link href={buildHref(ownerId, current, { funil: "" })} className={chip(!funil)}>
                Todos
              </Link>
              {funnelChips.map((c) => (
                <Link key={c.id} href={buildHref(ownerId, current, { funil: c.id })} className={chip(funil === c.id)}>
                  {c.name} · {c.count}
                </Link>
              ))}
            </div>
          )}
        </div>

        {result.items.length === 0 ? (
          <div className="card p-10 text-center text-sm text-neutral-400 dark:text-neutral-500">
            Nenhum negócio ganho neste filtro.
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-100 text-[11px] tracking-wide text-neutral-500 uppercase dark:border-neutral-800 dark:text-neutral-400">
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium">Negócio</th>
                    <th className="px-4 py-3 font-medium">Tipo de crédito</th>
                    <th className="px-4 py-3 font-medium">Funil</th>
                    <th className="px-4 py-3 font-medium">Fechado em</th>
                    <th className="px-4 py-3 text-right font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {result.items.map((d) => (
                    <tr key={d.id} className="transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                      <td className="px-4 py-2.5">
                        <Link href={`/clientes/${d.contactId}`} className="font-medium text-neutral-900 hover:text-brand dark:text-neutral-100">
                          {d.contactName}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <Link href={`/negocios/${d.id}`} className="text-neutral-600 hover:text-brand dark:text-neutral-300">
                          {d.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-neutral-600 dark:text-neutral-300">{d.creditType ?? "—"}</td>
                      <td className="px-4 py-2.5 text-neutral-500 dark:text-neutral-400">{d.pipelineName}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-neutral-500 tabular-nums dark:text-neutral-400">{formatDay(d.closedAt)}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <span className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                          {formatCurrency(d.value)}
                        </span>
                        {/* Bruto só quando difere do líquido — os dois iguais seria ruído. */}
                        {d.grossValue !== null && d.grossValue !== d.value && (
                          <span className="block text-[11px] tabular-nums text-neutral-400 dark:text-neutral-500">
                            bruto: {formatCurrency(d.grossValue)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-500 dark:text-neutral-400">
              Página {pagina} de {totalPages} · {result.total} negócios
            </span>
            <div className="flex gap-2">
              {pagina > 1 ? (
                <Link href={buildHref(ownerId, current, { pagina: pagina - 1 })} className="btn-secondary btn-sm">
                  <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
                  Anterior
                </Link>
              ) : null}
              {pagina < totalPages ? (
                <Link href={buildHref(ownerId, current, { pagina: pagina + 1 })} className="btn-secondary btn-sm">
                  Próxima
                  <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
                </Link>
              ) : null}
            </div>
          </div>
        )}
      </div>
    );
  });
}

function Kpi({ label, value, small, subValue }: { label: string; value: string; small?: boolean; subValue?: string | null }) {
  return (
    <div className="card p-4">
      <p className="text-[11px] tracking-wide text-neutral-500 uppercase dark:text-neutral-400">{label}</p>
      <p className={`mt-1 font-bold tabular-nums text-neutral-900 dark:text-neutral-100 ${small ? "text-sm leading-6" : "text-xl"}`}>{value}</p>
      {subValue && <p className="text-[11px] text-neutral-400 tabular-nums dark:text-neutral-500">{subValue}</p>}
    </div>
  );
}
