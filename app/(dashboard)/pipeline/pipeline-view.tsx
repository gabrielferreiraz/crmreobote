"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Kanban, List, Upload, Plus, CalendarClock, ClipboardX, Clock3, TrendingUp } from "lucide-react";
import { ImportDialog } from "@/components/import-dialog";
import { Select } from "@/components/select";
import { NewDealDialog } from "./new-deal-dialog";
import { KanbanBoard, type Deal } from "./kanban-board";
import { DealsList } from "./deals-list";
import { popBulkSendDraft, type BulkSendDraft } from "@/lib/pipeline-bulk-send-draft";
import type { CustomFieldDefinitionInput } from "@/components/custom-fields-fieldset";
import { formatCurrencyCompact } from "@/lib/format";
import { isPipelineQuickFilter, type PipelineQuickFilter } from "./pipeline-filters";

type MemberOption = { id: string; name: string };
type MemberFilterOption = { id: string; name: string; active: boolean };
type LossReasonOption = { id: string; label: string };
type CreditTypeOption = { id: string; label: string };
type LabelOption = { label: string };
type Stage = { id: string; name: string; color: string | null; order: number };
type PipelineOption = { id: string; name: string; stages: { id: string; name: string }[] };
type Sums = { wonSum: number; lostSum: number; totalSum: number };

const QUICK_FILTER_TILES: { value: PipelineQuickFilter; label: string; icon: typeof CalendarClock }[] = [
  { value: "acao-hoje", label: "Ação hoje", icon: CalendarClock },
  { value: "sem-tarefa", label: "Sem tarefa", icon: ClipboardX },
  { value: "parados-14d", label: "Parados +14d", icon: Clock3 },
];

export function PipelineView({
  pipelineId,
  pipelines,
  stages,
  initialKanbanByStage,
  initialKanbanCountByStage,
  initialKanbanSumByStage,
  initialKanbanWithTaskByStage,
  initialListaDeals,
  listaTotalCount,
  listaSums,
  currentUserId,
  members,
  allMembers,
  lossReasons,
  customFields,
  creditTypes,
  leadSources,
  jobTitles,
  isOwner,
  canBulkDelete,
  canBulkMessage,
  openNewDeal,
  goalValue,
  goalAchievedValue,
}: {
  pipelineId: string;
  pipelines: PipelineOption[];
  stages: Stage[];
  /** 1ª página de cada coluna (por etapa) — ver KanbanBoard, que pagina cada uma independente com "Carregar mais". */
  initialKanbanByStage: Record<string, Deal[]>;
  /** Total real (banco) de negócios OPEN por etapa — pode ser bem maior que initialKanbanByStage[id].length. */
  initialKanbanCountByStage: Record<string, number>;
  /** Soma de valor OPEN por etapa (banco, não só o carregado) — alimenta o card "valor em aberto" e o cabeçalho de cada coluna. */
  initialKanbanSumByStage: Record<string, number>;
  /** Quantos negócios OPEN de cada etapa têm ao menos uma tarefa pendente — "saúde da etapa" (ver kanban-board.tsx). */
  initialKanbanWithTaskByStage: Record<string, number>;
  initialListaDeals: Deal[];
  /** Total de negócios do pipeline (todos os status, sem filtro) no banco — pode ser bem maior que initialListaDeals.length (só a 1ª página vem carregada, ver deals-list.tsx). */
  listaTotalCount: number;
  /** Somas de Ganhos/Perdidos/Total sem filtro nenhum — ver aggregateDealValues em lib/deals/list-query.ts. */
  listaSums: Sums;
  /** Pra "Eu" aparecer sempre em primeiro nos filtros de Responsável (Kanban/Lista, ver lib/sort-self-first.ts). */
  currentUserId: string;
  members: MemberOption[];
  allMembers: MemberFilterOption[];
  lossReasons: LossReasonOption[];
  customFields: CustomFieldDefinitionInput[];
  creditTypes: CreditTypeOption[];
  /** Listas canônicas (Configurações → Origens/Cargos) pros filtros do Kanban — ver kanban-board.tsx. */
  leadSources: LabelOption[];
  jobTitles: LabelOption[];
  isOwner: boolean;
  canBulkDelete: boolean;
  canBulkMessage: boolean;
  openNewDeal?: boolean;
  /** Meta do mês corrente — sempre organização inteira, só vem preenchida pro Dono (ver page.tsx). null = não se aplica a este papel. */
  goalValue: number | null;
  goalAchievedValue: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [view, setView] = useState<"kanban" | "lista">("kanban");

  // Filtro rápido único (Ação hoje/Sem tarefa/Parados +14d) — sincronizado com
  // a URL (?filter=) pra o card "Exige ação" do Início conseguir linkar direto
  // pra um Pipeline já pré-filtrado (ver pipeline-filters.ts). Clicar de novo
  // no filtro já ativo remove (nunca mais de um ativo ao mesmo tempo).
  const filterParam = searchParams.get("filter");
  const quickFilter = isPipelineQuickFilter(filterParam) ? filterParam : null;

  function toggleQuickFilter(next: PipelineQuickFilter) {
    const params = new URLSearchParams(searchParams.toString());
    if (quickFilter === next) {
      params.delete("filter");
    } else {
      params.set("filter", next);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  const totalAberto = Object.values(initialKanbanSumByStage).reduce((sum, v) => sum + v, 0);
  const totalAbertoCount = Object.values(initialKanbanCountByStage).reduce((sum, v) => sum + v, 0);
  const goalPct =
    goalValue && goalValue > 0 ? Math.min(100, Math.round(((goalAchievedValue ?? 0) / goalValue) * 100)) : null;
  // KanbanBoard é dono do próprio estado por coluna (ver kanban-board.tsx) —
  // isso só entrega o negócio recém-criado uma única vez (consumido pelo
  // filho via onNewDealConsumed, mesmo padrão do openNewDeal abaixo).
  const [newDeal, setNewDeal] = useState<Deal | null>(null);
  // DealsList é dono da própria página/filtro (ver deals-list.tsx) — isso só
  // precisa avisar "algo mudou, busque nem que seja a mesma página/filtro de
  // novo" quando um negócio é criado ou uma importação termina.
  const [listaReloadToken, setListaReloadToken] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [dealDialogOpen, setDealDialogOpen] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState<BulkSendDraft | null>(null);

  useEffect(() => {
    if (openNewDeal) {
      setDealDialogOpen(true);
      router.replace("/pipeline");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNewDeal]);

  // Volta de "+ Criar script" (ver components/bulk-send-message-dialog.tsx) —
  // restaura a view Lista e repassa filtro/seleção pra deals-list.tsx
  // restaurar e reabrir o diálogo de envio sozinho. Não dá pra virar um
  // useState(() => ...) lazy: sessionStorage não existe durante a
  // renderização no servidor, só depois de montado no cliente.
  useEffect(() => {
    const draft = popBulkSendDraft();
    if (draft) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setView("lista");
      setRestoredDraft(draft);
    }
  }, []);

  return (
    // min-h-0: deixa o filho Kanban/Lista encolher de verdade até a altura
    // disponível (ver o mesmo comentário, mais detalhado, em kanban-board.tsx)
    // em vez de crescer pro tamanho do próprio conteúdo e vazar o scroll pra
    // página inteira.
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Card "valor em aberto" (gradiente de marca) + tiles de filtro rápido —
          ver new-design-for-claude/README.md. O total vem da 1ª carga do
          servidor (não recalcula a cada filtro client-side aplicado no
          Kanban/Lista) — é um indicador de saúde do funil, não um resultado
          filtrado. */}
      <div className="grid shrink-0 grid-cols-1 gap-2.5 sm:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))]">
        <div
          className="relative overflow-hidden rounded-xl px-4 py-2.5 text-white"
          style={{ background: "var(--brand-gradient-hero, var(--brand-gradient))" }}
        >
          <p className="text-[10px] leading-none font-medium tracking-wide text-white/75 uppercase">Valor em aberto</p>
          <p className="mt-1 text-xl leading-none font-semibold tabular-nums">{formatCurrencyCompact(totalAberto)}</p>
          {goalPct !== null ? (
            <div className="mt-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-medium text-white/85">
                <TrendingUp className="h-2.5 w-2.5 shrink-0" strokeWidth={2.5} />
                {goalPct}% da meta de {formatCurrencyCompact(goalValue)} fechado no mês
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/20">
                <div className="h-full rounded-full bg-white/85" style={{ width: `${goalPct}%` }} />
              </div>
            </div>
          ) : (
            <p className="mt-1.5 text-[10px] font-medium text-white/70">
              {totalAbertoCount} negócio{totalAbertoCount === 1 ? "" : "s"} em andamento no funil
            </p>
          )}
        </div>
        {QUICK_FILTER_TILES.map(({ value, label, icon: Icon }) => {
          const active = quickFilter === value;
          return (
            <button
              key={value}
              onClick={() => toggleQuickFilter(value)}
              className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                active
                  ? "border-[var(--brand)] bg-[var(--brand-light)] dark:bg-[var(--brand-subtle)] ring-1 ring-[var(--brand)]"
                  : "card hover:border-neutral-300 dark:hover:border-neutral-700"
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                  active ? "bg-[var(--brand)] text-white" : "bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500"
                }`}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={2} />
              </span>
              <span
                className={`text-sm font-medium ${active ? "text-[var(--brand)]" : "text-neutral-700 dark:text-neutral-300"}`}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {pipelines.length > 1 && (
            <Select
              value={pipelineId}
              onChange={(v) => router.push(`/pipeline?pipelineId=${v}`)}
              className="w-auto py-1.5 text-sm"
              options={pipelines.map((p) => ({ value: p.id, label: p.name }))}
            />
          )}
          <div className="inline-flex rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-800 p-0.5">
            <button
              onClick={() => setView("kanban")}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${view === "kanban"
                  ? "bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-sm"
                  : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                }`}
            >
              <Kanban className="h-3.5 w-3.5" strokeWidth={2} />
              Kanban
            </button>
            <button
              onClick={() => setView("lista")}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${view === "lista"
                  ? "bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-sm"
                  : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                }`}
            >
              <List className="h-3.5 w-3.5" strokeWidth={2} />
              Lista
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setDealDialogOpen(true)} className="btn-primary">
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Novo negócio
          </button>
          <button onClick={() => setImportOpen(true)} className="btn-secondary">
            <Upload className="h-4 w-4" strokeWidth={2} />
            Importar
          </button>
        </div>
      </div>

      {view === "kanban" ? (
        <KanbanBoard
          pipelineId={pipelineId}
          stages={stages}
          initialDealsByStage={initialKanbanByStage}
          initialCountByStage={initialKanbanCountByStage}
          initialSumByStage={initialKanbanSumByStage}
          initialWithTaskByStage={initialKanbanWithTaskByStage}
          members={members}
          currentUserId={currentUserId}
          leadSources={leadSources}
          jobTitles={jobTitles}
          newDeal={newDeal}
          onNewDealConsumed={() => setNewDeal(null)}
          quickFilter={quickFilter}
        />
      ) : (
        <DealsList
          initialDeals={initialListaDeals}
          initialTotalCount={listaTotalCount}
          initialSums={listaSums}
          reloadToken={listaReloadToken}
          members={allMembers}
          currentUserId={currentUserId}
          stages={stages}
          pipelineId={pipelineId}
          pipelines={pipelines}
          lossReasons={lossReasons}
          canBulkDelete={canBulkDelete}
          canBulkMessage={canBulkMessage}
          canExport={isOwner}
          restoredDraft={restoredDraft}
          quickFilter={quickFilter}
        />
      )}

      <NewDealDialog
        pipelineId={pipelineId}
        firstStageId={stages[0]?.id}
        members={members}
        customFields={customFields}
        creditTypes={creditTypes}
        onCreated={(deal) => {
          setNewDeal(deal);
          setListaReloadToken((t) => t + 1);
        }}
        open={dealDialogOpen}
        onOpenChange={setDealDialogOpen}
        hideTrigger
      />

      {importOpen && (
        <ImportDialog
          title="Importar negócios"
          hint="Arquivo .csv ou .xlsx com colunas: contato (obrigatório), whatsapp, telefone/celular (número 2, usado se o WhatsApp não funcionar), email, origem, negocio, valor, etapa, responsavel, tipo de credito."
          endpoint="/api/deals/import"
          extraFields={{ pipelineId }}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            router.refresh();
            setListaReloadToken((t) => t + 1);
          }}
          renderSummary={(r) => {
            const parts: string[] = [];
            if (r.skipped > 0) parts.push(`${r.skipped} linhas ignoradas por falta de contato`);
            if (r.stageFallbacks) parts.push(`${r.stageFallbacks} caíram na etapa padrão (texto da coluna 'etapa' não encontrado)`);
            if (r.ownerFallbacks) parts.push(`${r.ownerFallbacks} caíram em responsável automático (texto da coluna 'responsavel' não encontrado)`);
            if (r.valueParseFailures) parts.push(`${r.valueParseFailures} ficaram sem valor (não consegui ler o número)`);
            return `${r.created} de ${r.total} negócios importados.${parts.length > 0 ? ` ${parts.join("; ")}.` : ""}`;
          }}
        />
      )}
    </div>
  );
}
