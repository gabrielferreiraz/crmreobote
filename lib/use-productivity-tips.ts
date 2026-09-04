"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { EvaluatedTip, ProductivityTipType } from "@/lib/productivity-tips/types";
import { saveBulkSendDraft } from "@/lib/pipeline-bulk-send-draft";
import { saveTasksScheduleDraft } from "@/lib/tasks-schedule-draft";

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
  const [tip, setTip] = useState<EvaluatedTip | null>(null);
  const [loading, setLoading] = useState(true);
  const dismissed = useRef(false);
  const consumed = useRef(false);

  const revaluate = useCallback(async () => {
    if (consumed.current) return;
    try {
      const res = await fetch(
        `/api/productivity-tips/evaluate?pathname=${encodeURIComponent(pathname)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = await res.json().catch(() => ({ tip: null }));
      setTip(data.tip ?? null);
    } catch {
      setTip(null);
    } finally {
      setLoading(false);
    }
  }, [pathname]);

  // Montagem + navegação com debounce
  useEffect(() => {
    setLoading(true);
    dismissed.current = false;
    consumed.current = false;
    const t = setTimeout(() => revaluate(), NAV_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [pathname, revaluate]);

  // Polling periódico
  useEffect(() => {
    const id = setInterval(() => revaluate(), REVAL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [revaluate]);

  // Quando o tip mudar, reseta os flags
  useEffect(() => {
    dismissed.current = false;
    consumed.current = false;
  }, [tip?.tipType, tip?.scope]);

  const dismiss = useCallback(
    async (mode: "today" | "forever") => {
      if (!tip) return;
      dismissed.current = true;
      setTip(null);
      await callDismiss(tip.tipType, tip.scope, mode === "forever");
    },
    [tip],
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
      setTip(null);
      callDismiss(tip.tipType, tip.scope, false);
    },
    [tip, router],
  );

  const onScheduleTasks = useCallback(
    (taskIds: string[]) => {
      if (!tip) return;
      consumed.current = true;
      saveTasksScheduleDraft({ taskIds });
      router.push("/agenda");
      setTip(null);
      callDismiss(tip.tipType, tip.scope, false);
    },
    [tip, router],
  );

  return {
    loading,
    tip,
    dismiss,
    onNoShowPickBatch,
    onScheduleTasks,
  };
}
