"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { EvaluatedTip, ProductivityTipType } from "@/lib/productivity-tips/types";
import { saveBulkSendDraft } from "@/lib/pipeline-bulk-send-draft";
import { saveTasksScheduleDraft } from "@/lib/tasks-schedule-draft";
import { useVisiblePoll } from "@/lib/use-visible-poll";

const REVAL_INTERVAL_MS = 2 * 60 * 1000;
const NAV_DEBOUNCE_MS = 1200;

async function callDismiss(tipType: ProductivityTipType, scope: string, forever: boolean) {
  try {
    await fetch("/api/productivity-tips/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipType, scope, forever }),
    });
  } catch {
    // Silencioso: falha de rede não deve quebrar a UX do usuário.
  }
}

export function useProductivityTips() {
  const pathname = usePathname();
  const router = useRouter();
  const [evaluation, setEvaluation] = useState<{
    pathname: string;
    tip: EvaluatedTip | null;
    loading: boolean;
  }>({ pathname, tip: null, loading: true });
  const isCurrentPath = evaluation.pathname === pathname;
  const tip = isCurrentPath ? evaluation.tip : null;
  const loading = !isCurrentPath || evaluation.loading;
  const dismissed = useRef(false);
  const consumed = useRef(false);

  const revaluate = useCallback(async () => {
    if (consumed.current) return;
    try {
      const res = await fetch(
        `/api/productivity-tips/evaluate?pathname=${encodeURIComponent(pathname)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setEvaluation({ pathname, tip: null, loading: false });
        return;
      }
      const data = await res.json().catch(() => ({ tip: null }));
      setEvaluation({ pathname, tip: data.tip ?? null, loading: false });
    } catch {
      setEvaluation({ pathname, tip: null, loading: false });
    }
  }, [pathname]);

  // Montagem + navegação com debounce
  useEffect(() => {
    dismissed.current = false;
    consumed.current = false;
    const t = setTimeout(() => revaluate(), NAV_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [pathname, revaluate]);

  // Polling periódico — só com a aba visível (ver lib/use-visible-poll.ts).
  // Este hook vive no layout do dashboard, então roda em TODA página: sem a
  // checagem de visibilidade, uma aba esquecida aberta ficava reavaliando as
  // dicas no servidor pra sempre, sem ninguém pra ler o resultado.
  //
  // O efeito de montagem/navegação acima (com debounce) continua sendo quem
  // busca na entrada da tela; aqui `skipFirstRun` evita que a chamada
  // imediata do useVisiblePoll duplique aquela busca.
  const skipFirstRun = useRef(true);
  useVisiblePoll(() => {
    if (skipFirstRun.current) {
      skipFirstRun.current = false;
      return;
    }
    return revaluate();
  }, REVAL_INTERVAL_MS);

  // Quando o tip mudar, reseta os flags
  useEffect(() => {
    dismissed.current = false;
    consumed.current = false;
  }, [tip?.tipType, tip?.scope]);

  const dismiss = useCallback(
    async (mode: "today" | "forever") => {
      if (!tip) return;
      dismissed.current = true;
      setEvaluation({ pathname, tip: null, loading: false });
      await callDismiss(tip.tipType, tip.scope, mode === "forever");
    },
    [pathname, tip],
  );

  // ─ Ações específicas por tipo ──────────────────────────────────────

  const onNoShowPickBatch = useCallback(
    (ids: string[]) => {
      if (!tip || ids.length === 0) return;
      consumed.current = true;
      // Usa o mesmo mecanismo de rascunho que "+ Criar script" do pipeline usa:
      // pipeline-view.tsx já detecta e abre a lista + dialog automaticamente.
      saveBulkSendDraft({
        filters: {},
        selectedIds: ids,
      });
      router.push("/pipeline");
      setEvaluation({ pathname, tip: null, loading: false });
      callDismiss(tip.tipType, tip.scope, false);
    },
    [pathname, tip, router],
  );

  const onScheduleTasks = useCallback(
    (taskIds: string[]) => {
      if (!tip) return;
      consumed.current = true;
      saveTasksScheduleDraft({ taskIds });
      router.push("/agenda");
      setEvaluation({ pathname, tip: null, loading: false });
      callDismiss(tip.tipType, tip.scope, false);
    },
    [pathname, tip, router],
  );

  return {
    loading,
    tip,
    dismiss,
    onNoShowPickBatch,
    onScheduleTasks,
  };
}
