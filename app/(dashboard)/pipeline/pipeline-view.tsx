"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Kanban, List, Upload, History, Plus, TrendingUp } from "lucide-react";
import { DealImportDialog } from "@/components/deal-import-dialog";
import { ImportHistoryDialog } from "@/components/import-history-dialog";
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
  canViewImportHistory,
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
  /** Botão "Histórico" ao lado de "Importar" (abre o ImportHistoryDialog) — só quem tem papel Dono/Gerente vê, mesmo gate de /api/deals/import/history. */
  canViewImportHistory: boolean;
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

  // Começa com o total do funil inteiro (carga do servidor, sem filtro) e o
  // Kanban reporta de novo (ver onTotalsChange abaixo) toda vez que o filtro
  // dele muda — assim o card "Valor em aberto" sempre bate com os negócios
  // que estão de fato aparecendo na tela, não com um total parado da 1ª
  // carga escondido atrás de busca/filtro/filtro rápido aplicados depois.
  const [kanbanTotals, setKanbanTotals] = useState({
    sum: Object.values(initialKanbanSumByStage).reduce((sum, v) => sum + v, 0),
    count: Object.values(initialKanbanCountByStage).reduce((sum, v) => sum + v, 0),
  });
  const totalAberto = kanbanTotals.sum;
  const totalAbertoCount = kanbanTotals.count;
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
  const [importHistoryOpen, setImportHistoryOpen] = useState(false);
  const [dealDialogOpen, setDealDialogOpen] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState<BulkSendDraft | null>(null);

  useEffect(() => {
    if (openNewDeal) {
      setDealDialogOpen(true);
      router.replace("/pipeline");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNewDeal]);

  // Ressincroniza quando o funil ativo muda (troca no seletor, ver
  // pipelineId acima) — sem isso, kanbanTotals ficava preso ao total do
  // funil anterior até o Kanban terminar de buscar e reportar de novo
  // (mesmo instante em que o resto da tela já mudou de funil).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKanbanTotals({
      sum: Object.values(initialKanbanSumByStage).reduce((sum, v) => sum + v, 0),
      count: Object.values(initialKanbanCountByStage).reduce((sum, v) => sum + v, 0),
    });
  }, [initialKanbanSumByStage, initialKanbanCountByStage]);

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
      {/* Card "valor em aberto" sozinho, no canto, numa linha própria acima
          do seletor de funil — não mais centralizado/dividindo a fileira com
          seletor+toggle e os botões de ação. Os 3 tiles de filtro rápido
          (Ação hoje/Sem tarefa/Parados +14d) que moravam do lado do card
          viraram botões pequenos na fileira de busca/filtro do Kanban e da
          Lista (ver PipelineQuickFilterButtons). */}
      <div
        className="relative w-64 shrink-0 overflow-hidden rounded-xl px-4 py-2.5 text-white"
        style={{ background: "var(--brand-gradient-hero, var(--brand-gradient))" }}
      >
        <p className="text-[10px] leading-none font-medium tracking-wide text-white/75 uppercase">Valor em aberto</p>
        <div className="mt-1 flex items-baseline gap-1.5">
          <p className="text-xl leading-none font-semibold tabular-nums">{formatCurrencyCompact(totalAberto)}</p>
          {/* Quantidade em unidade (não valor) — sempre visível, independente
              de ter % de meta pra mostrar ou não (antes só aparecia pra quem
              não tinha meta, escondida pra quem tinha). */}
          <p className="text-[10px] leading-none font-medium text-white/70 tabular-nums">
            {totalAbertoCount} negócio{totalAbertoCount === 1 ? "" : "s"}
          </p>
        </div>
        {goalPct !== null && (
          <div className="mt-1.5">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-white/85">
              <TrendingUp className="h-2.5 w-2.5 shrink-0" strokeWidth={2.5} />
              {goalPct}% da meta de {formatCurrencyCompact(goalValue)} fechado no mês
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/20">
              <div className="h-full rounded-full bg-white/85" style={{ width: `${goalPct}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
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
          {canViewImportHistory && (
            <button onClick={() => setImportHistoryOpen(true)} className="icon-btn" title="Histórico de importações">
              <History className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
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
          onToggleQuickFilter={toggleQuickFilter}
          onTotalsChange={setKanbanTotals}
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
          onToggleQuickFilter={toggleQuickFilter}
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
        <DealImportDialog
          pipelineId={pipelineId}
          members={members}
          stages={stages}
          creditTypes={creditTypes}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            router.refresh();
            setListaReloadToken((t) => t + 1);
          }}
        />
      )}

      {importHistoryOpen && <ImportHistoryDialog onClose={() => setImportHistoryOpen(false)} />}
    </div>
  );
}
