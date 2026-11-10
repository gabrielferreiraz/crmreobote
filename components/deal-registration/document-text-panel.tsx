"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Loader2, ScanText, Sparkles } from "lucide-react";
import { extractDocumentLines, type ReadLine, type ReadProgress } from "@/lib/ocr/extract-document-text";
import { findFields } from "@/lib/ocr/find-fields";
import { LOW_CONFIDENCE } from "@/lib/ocr/quality";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title="Copiar"
      aria-label={label}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          window.setTimeout(() => setDone(false), 1400);
        }
      }}
      className="shrink-0 rounded-md p-1 text-neutral-300 transition-colors hover:bg-neutral-200/70 hover:text-neutral-700 focus-visible:text-neutral-700 dark:text-neutral-600 dark:hover:bg-neutral-700/60 dark:hover:text-neutral-200"
    >
      {done ? <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.25} /> : <Copy className="h-3.5 w-3.5" strokeWidth={2} />}
    </button>
  );
}

/**
 * Texto do documento, lido sozinho ao abrir: dados conhecidos (CPF, datas, CEP…) no
 * topo e, abaixo, uma linha por conteúdo — cada uma com um botão de copiar discreto.
 * Linhas em que o OCR ficou em dúvida levam um ponto amarelo. Só aparece para o Administrativo.
 */
export function DocumentTextPanel({ src, fileName }: { src: string; fileName: string }) {
  const [lines, setLines] = useState<ReadLine[] | null>(null);
  const [progress, setProgress] = useState<ReadProgress>({ label: "Abrindo o documento…", fraction: null });
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    extractDocumentLines(src, fileName, (p) => !cancelled && setProgress(p))
      .then((result) => !cancelled && setLines(result))
      .catch((e: unknown) => {
        if (cancelled) return;
        console.error("[document-text] falha ao ler o documento", e);
        setError("Não consegui ler o texto deste documento.");
      });
    return () => {
      cancelled = true;
    };
  }, [src, fileName, attempt]);

  const fields = useMemo(() => (lines ? findFields(lines.map((l) => l.text)) : []), [lines]);
  const hasUncertain = !!lines?.some((l) => l.confidence !== null && l.confidence < LOW_CONFIDENCE);

  return (
    <aside className="flex min-h-0 flex-col rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
        <ScanText className="h-4 w-4 text-neutral-400" strokeWidth={1.75} />
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">Texto do documento</h3>
        {lines && lines.length > 0 && <CopyButton text={lines.map((l) => l.text).join("\n")} label="Copiar todo o texto" />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="space-y-2 p-4 text-sm text-neutral-500 dark:text-neutral-400">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setProgress({ label: "Abrindo o documento…", fraction: null });
                setAttempt((n) => n + 1);
              }}
              className="btn-secondary btn-sm"
            >
              Tentar de novo
            </button>
          </div>
        ) : !lines ? (
          <div className="space-y-2 p-4">
            <p className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" /> {progress.label}
            </p>
            {progress.fraction !== null && (
              <div className="h-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                <div className="h-full rounded-full bg-neutral-400 transition-all dark:bg-neutral-500" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
              </div>
            )}
            <p className="text-xs text-neutral-400 dark:text-neutral-500">Na primeira vez pode levar alguns segundos.</p>
          </div>
        ) : lines.length === 0 ? (
          <p className="p-4 text-sm text-neutral-500 dark:text-neutral-400">Nenhum texto encontrado neste documento.</p>
        ) : (
          <>
            {fields.length > 0 && (
              <section className="border-b border-neutral-100 bg-neutral-50/70 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-800/30">
                <h4 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
                  <Sparkles className="h-3 w-3" strokeWidth={2} /> Dados encontrados
                </h4>
                <ul>
                  {fields.map((f) => (
                    <li key={f.key} className="flex items-center gap-2 py-0.5">
                      <span className="w-28 shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{f.label}</span>
                      <span className="min-w-0 flex-1 text-sm font-medium break-words text-neutral-900 select-text dark:text-neutral-100">{f.value}</span>
                      <CopyButton text={f.value} label={`Copiar ${f.label}: ${f.value}`} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {lines.map((line, i) => {
                const uncertain = line.confidence !== null && line.confidence < LOW_CONFIDENCE;
                return (
                  <li key={`${i}-${line.text}`} className="flex items-start gap-1 py-1 pr-1.5 pl-3">
                    {uncertain && <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="Leitura incerta: confira com o documento" aria-label="Leitura incerta" />}
                    <span className="min-w-0 flex-1 py-0.5 text-sm break-words text-neutral-800 select-text dark:text-neutral-200">{line.text}</span>
                    <CopyButton text={line.text} label={`Copiar: ${line.text}`} />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {lines && lines.length > 0 && (
        <p className="border-t border-neutral-100 px-3 py-2 text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
          {hasUncertain ? "Ponto amarelo = leitura incerta. " : ""}Leitura automática: confira com o documento antes de usar.
        </p>
      )}
    </aside>
  );
}
