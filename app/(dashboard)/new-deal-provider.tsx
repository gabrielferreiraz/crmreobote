"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Loader2, Plus, X } from "lucide-react";
import { Modal } from "@/components/modal";
import { requestJson } from "@/lib/client-request";
import { DEAL_CREATED_EVENT } from "@/lib/deals/client-events";
import { trackUse } from "@/lib/feature-usage/track";
import { PIPELINE_LAST_ID_COOKIE } from "@/lib/pipeline-last-selected";
import type { CustomFieldDefinitionInput } from "@/components/custom-fields-fieldset";
import { NewDealContext, useNewDeal } from "@/components/deals/new-deal-context";
import type { Deal } from "./pipeline/kanban-board";
import { NewDealDialog } from "./pipeline/new-deal-dialog";

type NewDealOptions = {
  defaultPipelineId: string | null;
  pipelines: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }>;
  members: Array<{ id: string; name: string }>;
  customFields: CustomFieldDefinitionInput[];
  creditTypes: Array<{ id: string; label: string }>;
  jobTitles: Array<{ id: string; label: string }>;
};

const OPTIONS_TTL_MS = 5 * 60 * 1000;

function pipelineFromCookie(options: NewDealOptions): string | null {
  const prefix = `${PIPELINE_LAST_ID_COOKIE}=`;
  const saved = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length);
  if (saved && options.pipelines.some((pipeline) => pipeline.id === saved)) return saved;
  return options.defaultPipelineId ?? options.pipelines[0]?.id ?? null;
}

export function NewDealButton({ compact = false }: { compact?: boolean }) {
  const { openNewDeal, preloadNewDeal } = useNewDeal();
  return (
    <button
      type="button"
      data-help="new-deal"
      onClick={openNewDeal}
      onPointerEnter={preloadNewDeal}
      onFocus={preloadNewDeal}
      onTouchStart={preloadNewDeal}
      className={compact ? "icon-btn" : "btn-primary btn-sm"}
      aria-label={compact ? "Novo negócio" : undefined}
      title={compact ? "Novo negócio" : undefined}
    >
      <Plus className={compact ? "h-4 w-4" : "h-3.5 w-3.5"} strokeWidth={2.5} />
      {!compact && "Novo negócio"}
    </button>
  );
}

function LoadingDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} maxWidth="max-w-xl">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Novo negócio</h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Preparando o formulário...</p>
        </div>
        <button type="button" onClick={onClose} className="icon-btn -mt-1 -mr-1 h-8 w-8" aria-label="Fechar">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex min-h-56 items-center justify-center" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-brand" aria-hidden="true" />
        <span className="sr-only">Carregando formulário</span>
      </div>
    </Modal>
  );
}

function LoadErrorDialog({ message, onRetry, onClose }: { message: string; onRetry: () => void; onClose: () => void }) {
  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400">
          <AlertCircle className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">Não foi possível abrir</h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{message}</p>
        </div>
        <button type="button" onClick={onClose} className="icon-btn -mt-1 -mr-1 h-8 w-8" aria-label="Fechar">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-ghost">Fechar</button>
        <button type="button" onClick={onRetry} className="btn-primary">Tentar novamente</button>
      </div>
    </Modal>
  );
}

export function NewDealProvider({
  children,
  currentUserId,
  enabled,
}: {
  children: ReactNode;
  currentUserId: string;
  enabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<NewDealOptions | null>(null);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdDeal, setCreatedDeal] = useState<Deal | null>(null);
  const optionsRef = useRef<NewDealOptions | null>(null);
  const loadingPromiseRef = useRef<Promise<NewDealOptions | null> | null>(null);
  const loadedAtRef = useRef(0);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const loadOptions = useCallback((force = false) => {
    if (!enabled) return Promise.resolve(null);
    if (!force && optionsRef.current) return Promise.resolve(optionsRef.current);
    if (loadingPromiseRef.current) return loadingPromiseRef.current;

    setLoading(true);
    setError(null);
    const request = requestJson<NewDealOptions>("/api/deals/new/options", { cache: "no-store" }, { silent: true })
      .then((result) => {
        if (!mountedRef.current) return null;
        if (!result.ok) {
          setError(result.error);
          return null;
        }
        optionsRef.current = result.data;
        loadedAtRef.current = Date.now();
        setOptions(result.data);
        setSelectedPipelineId((current) =>
          current && result.data.pipelines.some((pipeline) => pipeline.id === current)
            ? current
            : pipelineFromCookie(result.data),
        );
        return result.data;
      })
      .finally(() => {
        loadingPromiseRef.current = null;
        if (mountedRef.current) setLoading(false);
      });
    loadingPromiseRef.current = request;
    return request;
  }, [enabled]);

  const preloadNewDeal = useCallback(() => {
    void loadOptions();
  }, [loadOptions]);

  const openNewDeal = useCallback(() => {
    if (!enabled) return;
    setOpen(true);
    const cached = optionsRef.current;
    if (cached) {
      setSelectedPipelineId(pipelineFromCookie(cached));
      if (Date.now() - loadedAtRef.current > OPTIONS_TTL_MS) void loadOptions(true);
    } else {
      void loadOptions();
    }
  }, [enabled, loadOptions]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(preloadNewDeal, 700);
    return () => window.clearTimeout(timer);
  }, [enabled, preloadNewDeal]);

  const selectedPipeline = options?.pipelines.find((pipeline) => pipeline.id === selectedPipelineId) ?? null;

  function handleCreated(deal: Deal) {
    trackUse("pipeline.negocio.novo");
    window.dispatchEvent(new CustomEvent(DEAL_CREATED_EVENT, {
      detail: { ...deal, pipelineId: selectedPipelineId },
    }));
    setCreatedDeal(deal);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setCreatedDeal(null), 5000);
  }

  const contextValue = useMemo(
    () => ({ openNewDeal, preloadNewDeal }),
    [openNewDeal, preloadNewDeal],
  );

  return (
    <NewDealContext.Provider value={contextValue}>
      {children}

      {open && !options && loading && <LoadingDialog onClose={() => setOpen(false)} />}
      {open && !options && !loading && error && (
        <LoadErrorDialog message={error} onClose={() => setOpen(false)} onRetry={() => void loadOptions(true)} />
      )}
      {open && options && options.pipelines.length === 0 && (
        <LoadErrorDialog
          message="Nenhum funil está configurado. Crie um funil antes de cadastrar negócios."
          onClose={() => setOpen(false)}
          onRetry={() => void loadOptions(true)}
        />
      )}
      {open && options && selectedPipeline && (
        <NewDealDialog
          key={selectedPipeline.id}
          pipelineId={selectedPipeline.id}
          firstStageId={selectedPipeline.stages[0]?.id}
          pipelines={options.pipelines}
          onPipelineChange={setSelectedPipelineId}
          members={options.members}
          customFields={options.customFields}
          creditTypes={options.creditTypes}
          jobTitles={options.jobTitles}
          currentUserId={currentUserId}
          onCreated={handleCreated}
          open
          onOpenChange={setOpen}
          hideTrigger
        />
      )}

      {createdDeal && (
        <div
          role="status"
          aria-live="polite"
          className="fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[60] flex max-w-sm items-center gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-3 shadow-xl dark:border-neutral-700 dark:bg-neutral-900 lg:bottom-4"
        >
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Negócio criado</p>
            <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{createdDeal.name}</p>
          </div>
          <Link href={`/negocios/${createdDeal.id}`} onClick={() => setCreatedDeal(null)} className="btn-ghost text-xs">
            Abrir
          </Link>
        </div>
      )}
    </NewDealContext.Provider>
  );
}
