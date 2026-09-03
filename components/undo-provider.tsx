"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Undo2, X } from "lucide-react";

const TOAST_MS = 30_000;
const MAX_STACKED = 3;

export type UndoToastInput = { id: string; description: string };
type UndoToast = UndoToastInput & { key: number };

type UndoContextValue = {
  /** Chama isso depois de QUALQUER mutação bem-sucedida que devolveu `undo`
   * na resposta (ver lib/undo/record.ts) — abre o aviso "X. Desfazer" no
   * canto inferior direito. */
  pushUndoToast: (input: UndoToastInput | null | undefined) => void;
};

const UndoContext = createContext<UndoContextValue | null>(null);

/** Qualquer client component descendente do layout pode chamar isso depois
 * de uma mutação — se `input` vier null/undefined (rota que ainda não
 * grava undo, ou ação sem nada pra desfazer), não faz nada, sem precisar
 * de `if` no chamador. */
export function useUndoToast(): UndoContextValue["pushUndoToast"] {
  const ctx = useContext(UndoContext);
  if (!ctx) throw new Error("useUndoToast precisa estar dentro de <UndoProvider> (ver app/(dashboard)/layout.tsx)");
  return ctx.pushUndoToast;
}

let toastKeySeq = 0;

/**
 * Ctrl+Z do sistema inteiro (ver plano em
 * C:\Users\Gabriel\.claude\plans\wise-dazzling-grove.md) — montado UMA VEZ
 * em app/(dashboard)/layout.tsx, igual PresenceHeartbeat/
 * PushNotificationsPrompt logo ao lado. Um único `keydown` global aqui
 * (diferente de components/command-palette.tsx, que é montado 2-3x ao
 * mesmo tempo entre desktop/compact/mobile — cada cópia com o PRÓPRIO
 * listener; não repetir isso pro Ctrl+Z).
 *
 * Portal pro document.body de propósito — mesmo motivo já documentado em
 * components/modal.tsx e corrigido no DragOverlay da Agenda nesta mesma
 * sessão: um `.card`/GlassCard ancestral com backdrop-filter vira
 * "containing block" de um position:fixed, descolando o aviso de onde
 * deveria estar. Sobrevive à navegação entre páginas do dashboard (o
 * layout nunca desmonta no App Router), então um aviso continua ativo
 * mesmo depois de sair da tela onde a ação aconteceu.
 */
export function UndoProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [toasts, setToasts] = useState<UndoToast[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  // UndoProvider embrulha o layout inteiro, então participa do 1º render no
  // SERVIDOR também (diferente de Modal, que só monta depois de alguma
  // interação — na prática nunca no SSR). `typeof document` direto no JSX
  // é exatamente o anti-padrão que o React avisa em erro de hidratação:
  // servidor (sem document) e cliente (com document) decidiam renderizar
  // coisas diferentes NO MESMO PONTO da árvore. `mounted` começa false nos
  // dois lados (1º render sempre bate), só vira true DEPOIS de montado no
  // cliente — uma atualização normal pós-hidratação, não uma divergência.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const dismiss = useCallback((key: number) => {
    const timer = timers.current.get(key);
    if (timer) clearTimeout(timer);
    timers.current.delete(key);
    setToasts((prev) => prev.filter((t) => t.key !== key));
  }, []);

  const scheduleDismiss = useCallback(
    (key: number) => {
      const timer = timers.current.get(key);
      if (timer) clearTimeout(timer);
      timers.current.set(
        key,
        setTimeout(() => dismiss(key), TOAST_MS),
      );
    },
    [dismiss],
  );

  const pushUndoToast = useCallback(
    (input: UndoToastInput | null | undefined) => {
      if (!input) return;
      const key = ++toastKeySeq;
      setToasts((prev) => {
        // Mais de MAX_STACKED ao mesmo tempo: o mais antigo sai (e seu timer
        // junto) pra não empilhar sem fim numa sequência rápida de ações.
        const next = [...prev, { ...input, key }];
        if (next.length > MAX_STACKED) {
          const [evicted, ...rest] = next;
          const timer = timers.current.get(evicted.key);
          if (timer) clearTimeout(timer);
          timers.current.delete(evicted.key);
          return rest;
        }
        return next;
      });
      scheduleDismiss(key);
    },
    [scheduleDismiss],
  );

  const undoingRef = useRef<Set<number>>(new Set());

  const performUndo = useCallback(
    async (key: number) => {
      if (undoingRef.current.has(key)) return; // clique duplo/Ctrl+Z repetido rápido enquanto já está em voo
      const toast = toasts.find((t) => t.key === key);
      if (!toast) return;
      undoingRef.current.add(key);
      try {
        const res = await fetch(`/api/undo/${toast.id}`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          dismiss(key);
          return;
        }
        router.refresh();
        // Troca o MESMO aviso pro texto de "desfeito" (ver POST /api/undo/[id],
        // que já devolve o par invertido pronto) — clicar/Ctrl+Z de novo
        // desfaz o desfazer, é a mesma cadeia se repetindo, nunca um aviso
        // novo empilhado em cima.
        setToasts((prev) => prev.map((t) => (t.key === key ? { ...t, id: data.undo.id, description: data.undo.description } : t)));
        scheduleDismiss(key);
      } catch {
        // Falha de rede — deixa o aviso como está, timer original continua
        // correndo; a pessoa pode tentar de novo enquanto ele existir.
      } finally {
        undoingRef.current.delete(key);
      }
    },
    [toasts, dismiss, router, scheduleDismiss],
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement | null;
      // Nunca disputa com o Ctrl+Z nativo de um campo de texto (desfazer
      // digitação é sempre prioridade de quem está digitando).
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      setToasts((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        e.preventDefault();
        performUndo(last.key);
        return prev;
      });
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [performUndo]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
    };
  }, []);

  return (
    <UndoContext.Provider value={{ pushUndoToast }}>
      {children}
      {mounted &&
        createPortal(
          <div className="pointer-events-none fixed right-4 bottom-4 z-[70] flex flex-col-reverse gap-2">
            {toasts.map((t) => (
              <div
                key={t.key}
                className="animate-pop-in pointer-events-auto flex max-w-sm items-center gap-3 rounded-lg bg-neutral-900 px-3.5 py-2.5 text-sm text-white shadow-2xl ring-1 ring-white/10 dark:bg-neutral-800"
                style={{ transformOrigin: "bottom right" }}
              >
                <span className="min-w-0 flex-1 truncate">{t.description}</span>
                <button
                  type="button"
                  onClick={() => performUndo(t.key)}
                  className="inline-flex shrink-0 items-center gap-1 font-semibold text-white hover:underline"
                >
                  <Undo2 className="h-3.5 w-3.5" strokeWidth={2.5} />
                  Desfazer
                </button>
                <button
                  type="button"
                  onClick={() => dismiss(t.key)}
                  aria-label="Fechar aviso"
                  className="shrink-0 text-neutral-400 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </UndoContext.Provider>
  );
}
