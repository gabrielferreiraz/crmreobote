"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, ExternalLink, ChevronDown } from "lucide-react";
import { saveTvConfig } from "./actions";
import { MessageDialog } from "@/components/message-dialog";
import { TvAdCropDialog } from "./tv-ad-crop-dialog";
import { TV_AD_ASPECT_RATIO } from "./tv-ad-aspect";

export const AVAILABLE_WIDGETS = [
  { id: "sales_summary", label: "Resumo de Vendas (Anuais, Cotas, Mês atual)" },
  { id: "churrascometro", label: "Churrascômetro" },
  { id: "last_sale", label: "Última Venda" },
  { id: "funnels", label: "Leads no Funil" },
  { id: "ranking", label: "Ranking de Empresas (Top 3)" },
];

export function TvConfigForm({
  initialAdsUrls,
  initialVisibleWidgets,
  initialSelectedStageIds,
  allStages,
}: {
  initialAdsUrls: string[];
  initialVisibleWidgets: string[];
  initialSelectedStageIds: string[];
  /** pipelineName vem junto pra poder agrupar — organização com mais de um
   * funil repete nome de etapa (ex.: "Prospecção" em vários funis), uma
   * lista plana fica ambígua sobre qual etapa é de qual funil. */
  allStages: { id: string; name: string; pipelineName: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Substitui os alert()/confirm() nativos do navegador que essa tela usava
  // pra avisar sucesso/erro (feios, sem dark mode, destoando do resto do
  // app) — ver components/message-dialog.tsx.
  const [message, setMessage] = useState<{ tone: "success" | "error"; title: string } | null>(null);

  const [adsUrls, setAdsUrls] = useState<string[]>(initialAdsUrls);
  const adFileInputRef = useRef<HTMLInputElement>(null);
  // Arquivo escolhido, ainda não cortado — abre a ferramenta de corte (ver
  // tv-ad-crop-dialog.tsx) ANTES de subir qualquer coisa pro bucket; o
  // upload de verdade só acontece depois que a área é confirmada. Enquanto
  // isso estiver preenchido, o Modal cobre a tela inteira — progresso/erro
  // do envio vivem dentro do próprio diálogo (ver TvAdCropDialog), não aqui.
  const [pendingAd, setPendingAd] = useState<{ file: File; objectUrl: string } | null>(null);

  const [visibleWidgets, setVisibleWidgets] = useState<string[]>(initialVisibleWidgets);
  const [selectedStageIds, setSelectedStageIds] = useState<string[]>(initialSelectedStageIds);

  // Lista suspensa (fechada por padrão) em vez da lista de etapas cravada
  // direto na página — com vários funis, a lista plana passava de 20 linhas
  // (várias com o mesmo nome, sem dizer de qual funil), empurrando o resto
  // do formulário pra baixo. Fecha sozinha ao clicar fora, mesmo padrão do
  // FilterPopover (ver components/filter-popover.tsx).
  const [stagesOpen, setStagesOpen] = useState(false);
  const stagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (stagesRef.current && !stagesRef.current.contains(e.target as Node)) {
        setStagesOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Agrupado por funil, na ordem em que allStages já chegou (page.tsx já
  // ordena por funil → etapa) — Map preserva a ordem de inserção das chaves.
  const stagesByPipeline = new Map<string, { id: string; name: string }[]>();
  for (const stage of allStages) {
    const list = stagesByPipeline.get(stage.pipelineName) ?? [];
    list.push(stage);
    stagesByPipeline.set(stage.pipelineName, list);
  }

  const toggleWidget = (id: string) => {
    setVisibleWidgets((prev) =>
      prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id]
    );
  };

  const toggleStage = (id: string) => {
    setSelectedStageIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  // Não sobe direto — primeiro abre a ferramenta de corte (ver
  // tv-ad-crop-dialog.tsx), travada no formato exato da tela de propaganda
  // da TV. O upload de verdade só acontece em uploadCroppedAd, depois que a
  // área é confirmada.
  function handleAdFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPendingAd({ file, objectUrl: URL.createObjectURL(file) });
  }

  function closeCropDialog() {
    if (pendingAd) URL.revokeObjectURL(pendingAd.objectUrl);
    setPendingAd(null);
  }

  // Lança o erro em vez de engolir — TvAdCropDialog é quem decide o que
  // fazer com ele (mostra dentro do próprio diálogo, que fica por cima de
  // tudo; um erro guardado aqui no formulário ficaria escondido atrás do
  // Modal, invisível até a comemoração... digo, até fechar o diálogo).
  async function uploadCroppedAd(blob: Blob) {
    const formData = new FormData();
    formData.append("file", blob, "propaganda.jpg");

    const res = await fetch("/api/tv/ads", { method: "POST", body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Erro ao enviar imagem");

    setAdsUrls((prev) => [...prev, data.url]);
    closeCropDialog();
  }

  // Remove da lista local na hora e já apaga do bucket em segundo plano —
  // link colado à mão antes dessa funcionalidade existir (ou base64 salvo
  // por engano) não bate o prefixo do bucket público, então a rota só tira
  // da lista sem tentar apagar nada (ver deleteTvAdByUrl em lib/r2.ts).
  function removeAd(url: string) {
    setAdsUrls((prev) => prev.filter((u) => u !== url));
    fetch("/api/tv/ads", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }).catch(() => {});
  }

  const handleSave = async () => {
    setBusy(true);
    try {
      const result = await saveTvConfig({
        adsUrls,
        selectedStageIds,
        visibleWidgets,
      });
      if (result && !result.success) {
        setMessage({ tone: "error", title: result.error || "Erro ao salvar." });
      } else {
        setMessage({ tone: "success", title: "Salvo com sucesso!" });
        router.refresh();
      }
    } catch {
      setMessage({ tone: "error", title: "Erro crítico ao salvar." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl py-6">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            Configurações da TV
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Gerencie o que aparece no dashboard da televisão
          </p>
        </div>
        <a
          href="/tv"
          target="_blank"
          className="inline-flex items-center gap-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
        >
          <ExternalLink className="h-4 w-4" />
          Abrir TV
        </a>
      </div>

      <div className="space-y-6 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        
        {/* O que mostrar */}
        <div>
          <label className="mb-3 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            O que mostrar na TV?
          </label>
          <div className="space-y-2">
            {AVAILABLE_WIDGETS.map((widget) => (
              <label key={widget.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={visibleWidgets.includes(widget.id)}
                  onChange={() => toggleWidget(widget.id)}
                  className="rounded border-neutral-300 text-blue-600 focus:ring-blue-600"
                />
                <span className="text-sm text-neutral-700 dark:text-neutral-300">
                  {widget.label}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Etapas do Funil */}
        {visibleWidgets.includes("funnels") && (
          <div className="rounded-md bg-neutral-50 p-4 dark:bg-neutral-800/50">
            <label className="mb-3 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Etapas do Funil para exibir (Leads no Funil)
            </label>
            <div ref={stagesRef} className="relative">
              <button
                type="button"
                onClick={() => setStagesOpen((v) => !v)}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 text-left text-sm text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
              >
                <span>
                  {selectedStageIds.length === 0
                    ? "Nenhuma etapa selecionada"
                    : `${selectedStageIds.length} etapa${selectedStageIds.length === 1 ? "" : "s"} selecionada${selectedStageIds.length === 1 ? "" : "s"}`}
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${stagesOpen ? "rotate-180" : ""}`}
                />
              </button>

              {stagesOpen && (
                <div className="absolute z-10 mt-1 max-h-72 w-full space-y-3 overflow-y-auto rounded-md border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                  {Array.from(stagesByPipeline.entries()).map(([pipelineName, stages]) => (
                    <div key={pipelineName}>
                      <p className="mb-1.5 text-xs font-semibold tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
                        {pipelineName}
                      </p>
                      <div className="space-y-1.5">
                        {stages.map((stage) => (
                          <label key={stage.id} className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selectedStageIds.includes(stage.id)}
                              onChange={() => toggleStage(stage.id)}
                              className="rounded border-neutral-300 text-blue-600 focus:ring-blue-600"
                            />
                            <span className="text-sm text-neutral-700 dark:text-neutral-300">
                              {stage.name}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  {allStages.length === 0 && (
                    <p className="text-sm text-neutral-500">Nenhuma etapa encontrada.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Propagandas */}
        <div>
          <label className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Propagandas (Imagens)
          </label>

          {adsUrls.length > 0 && (
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {adsUrls.map((url, i) => (
                <div
                  key={url}
                  style={{ aspectRatio: TV_AD_ASPECT_RATIO }}
                  className="group relative overflow-hidden rounded-md border border-neutral-200 bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800"
                >
                  <img src={url} alt={`Propaganda ${i + 1}`} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeAd(url)}
                    aria-label="Remover imagem"
                    className="absolute top-1.5 right-1.5 rounded bg-black/60 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 coarse:opacity-100 hover:bg-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <input
            ref={adFileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleAdFileSelected}
          />
          <button
            type="button"
            onClick={() => adFileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded bg-neutral-100 px-3 py-2 text-sm font-medium hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          >
            <Plus className="h-4 w-4" />
            Enviar imagem
          </button>
          <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">JPEG, PNG ou WebP · até 10MB.</p>
        </div>

        <div className="pt-4">
          <button
            onClick={handleSave}
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar Configurações
          </button>
        </div>
      </div>

      {message && <MessageDialog tone={message.tone} title={message.title} onClose={() => setMessage(null)} />}

      {pendingAd && (
        <TvAdCropDialog imageSrc={pendingAd.objectUrl} onCancel={closeCropDialog} onConfirm={uploadCroppedAd} />
      )}
    </div>
  );
}
