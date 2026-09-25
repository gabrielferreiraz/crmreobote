"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, Loader2, ArrowLeft, X, Shuffle, MessageCircleMore, Pencil, Globe2, Lock, ImagePlus, Image as ImageIcon } from "lucide-react";
import { VariablePills } from "@/components/variable-pills";
import { LoadingDots } from "@/components/loading-dots";
import { WhatsAppPhonePreview } from "@/components/whatsapp-phone-preview";
import { MessageVariationEditor } from "@/components/message-variation-editor";
import { renderTemplate } from "@/lib/campaigns/spintax";
import type { ScriptStep } from "@/lib/campaigns/spintax";
import { normalizeSteps, textChangeRatio } from "@/lib/campaigns/script-steps";
import { SYNONYM_REGEX, synonymsFor } from "@/lib/message-synonyms";
import { ScriptSaveDialog, type ScriptImpactDTO, type ScriptSaveChoice } from "./script-save-dialog";

type Step = ScriptStep & { previewUrl?: string };

const SAMPLE_VARS = { nome: "Maria Silva", cargo: "Advogada", empresa: "Empresa Exemplo", cidade: "Sua Cidade" };
const MAX_DELAY_SEC = 120;
/** Acima disso (fração do texto que mudou) o diálogo de salvar sugere "nova versão" em vez de "correção". */
const NEW_VERSION_SUGGESTION_RATIO = 0.35;

const TOKEN_LABEL = new Map<string, string>([
  ["nome", "Nome"],
  ["primeiro_nome", "1º nome"],
  ["cargo", "Cargo"],
  ["empresa", "Empresa"],
  ["cidade", "Cidade"],
  ["consultor", "Consultor"],
  ["saudacao", "Saudação"],
]);
// Casa tokens de variável conhecidos (ex.: "{cargo}") E blocos de variação
// "{[opção 1|opção 2]}" (sintaxe spintax, ver lib/campaigns/spintax.ts) —
// ambos viram pílula no editor, nunca ficam como chave/colchete cru na tela.
// O corpo da variação aceita "{token}" dentro (só "[" e "]" ficam de fora —
// mesma regra de lib/campaigns/spintax.ts), pra permitir variável dentro de
// uma opção (ex.: "Oi {primeiro_nome}!" como uma das frases alternativas).
const VARIATION_GROUP_RE = "\\{\\[[^\\[\\]]+\\]\\}";
const TOKEN_RE = new RegExp(`(\\{(?:${Array.from(TOKEN_LABEL.keys()).join("|")})\\}|${VARIATION_GROUP_RE})`, "g");

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildChipHtml(token: string): string {
  const label = TOKEN_LABEL.get(token) ?? token;
  return `<span contenteditable="false" data-token="${token}" class="variable-pill variable-pill--clickable" title="Clique para remover">${label}</span> `;
}

/** Pílula de variação — guarda as opções em data-variation-options (JSON) pra reabrir o editor visual depois. */
function buildVariationChipHtml(options: string[]): string {
  const encoded = encodeURIComponent(JSON.stringify(options));
  const label = escapeHtml(options.join(" / "));
  return `<span contenteditable="false" data-variation-options="${encoded}" class="variation-pill" title="Clique para editar as opções">🔀 ${label}<span data-variation-remove="true" class="variation-pill__remove" title="Remover variação">×</span></span> `;
}

/** Pílula AZUL de sugestão de sinônimo (ver lib/message-synonyms.ts) — nunca
 * faz parte da mensagem salva (ver serializeEditor abaixo, que pula ela de
 * propósito); só existe até a pessoa clicar (vira variação de verdade) ou
 * digitar de novo (some e talvez reapareça em outra palavra, ver
 * scheduleSynonymSuggestions). `data-synonym-key` guarda a forma exata
 * digitada, com a MAIÚSCULA original preservada — precisa dela intacta pra
 * virar a 1ª opção da variação quando clicada.
 */
function buildSynonymSuggestionHtml(matchedText: string): string {
  return `<span contenteditable="false" data-synonym-key="${escapeHtml(matchedText)}" class="synonym-suggestion-pill" title="Clique para variar esta palavra também">🔄 sinônimo</span>`;
}

/** Pílula "usar todos" — some no fim do texto quando tem mais de uma
 * sugestão azul ativa ao mesmo tempo (ver applySynonymSuggestions), pra
 * transformar todas em variação de uma vez só, sem precisar clicar pílula
 * por pílula. Nunca faz parte da mensagem salva (mesma lógica de
 * buildSynonymSuggestionHtml, ver serializeEditor abaixo). */
function buildSynonymApplyAllHtml(): string {
  return ` <span contenteditable="false" data-synonym-apply-all="true" class="synonym-suggestion-pill synonym-suggestion-pill--all" title="Trocar todas as palavras sugeridas de uma vez">✅ usar todos</span>`;
}

/** DOM do editor → string com `{token}`/`{[a|b]}` (mesmo formato que sempre foi salvo/renderizado). */
function serializeEditor(root: HTMLElement): string {
  let out = "";
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
    } else if (node instanceof HTMLElement) {
      if (node.dataset.variationOptions) {
        const options: string[] = JSON.parse(decodeURIComponent(node.dataset.variationOptions));
        out += `{[${options.join("|")}]}`;
      } else if (node.dataset.token) {
        out += `{${node.dataset.token}}`;
      } else if (node.dataset.synonymKey !== undefined || node.dataset.synonymApplyAll !== undefined) {
        // Sugestão (ou o botão "usar todos") ainda não confirmada — não é
        // conteúdo de verdade, some da mensagem salva (ver comentário em
        // buildSynonymSuggestionHtml/buildSynonymApplyAllHtml).
        continue;
      } else if (node.tagName === "BR") {
        out += "\n";
      } else {
        out += node.textContent ?? "";
      }
    }
  }
  return out;
}

/** string com `{token}`/`{[a|b]}` → DOM (pílulas + texto) — só roda uma vez, no mount de cada editor. */
function deserializeIntoEditor(root: HTMLElement, value: string) {
  root.innerHTML = "";
  const parts = value.split(TOKEN_RE);
  for (const part of parts) {
    const tokenMatch = part.match(/^\{(\w+)\}$/);
    const variationMatch = part.match(/^\{\[([^[\]]+)\]\}$/);
    if (tokenMatch && TOKEN_LABEL.has(tokenMatch[1])) {
      const wrapper = document.createElement("span");
      wrapper.innerHTML = buildChipHtml(tokenMatch[1]);
      while (wrapper.firstChild) root.appendChild(wrapper.firstChild);
    } else if (variationMatch) {
      const wrapper = document.createElement("span");
      wrapper.innerHTML = buildVariationChipHtml(variationMatch[1].split("|"));
      while (wrapper.firstChild) root.appendChild(wrapper.firstChild);
    } else if (part) {
      part.split("\n").forEach((line, i) => {
        if (i > 0) root.appendChild(document.createElement("br"));
        if (line) root.appendChild(document.createTextNode(line));
      });
    }
  }
}

function ensureFocusInsideEditor(el: HTMLElement) {
  const sel = window.getSelection();
  const hasSelectionInside = !!sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer);
  if (!hasSelectionInside) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
}

/** Sorteia um valor dentro de [min, max] — usado só quando defaultStepDelayRange é passado. */
function randomInRange([min, max]: [number, number]): number {
  return Math.round(min + Math.random() * (max - min));
}

/**
 * Posição (fixed) pro botão/popover flutuante de variação, a partir do
 * retângulo do texto selecionado (ou da pílula clicada) — calculado uma vez
 * só na abertura, não reativo a scroll/resize (o popover é uma interação
 * curta: abre, preenche, salva/cancela; não vale a complexidade de
 * reposicionar ao vivo pra essa janela de tempo). `width` é só uma
 * estimativa pra decidir se cabe à esquerda ou precisa empurrar pra dentro
 * da tela — o elemento real usa `max-w`, não largura fixa.
 */
function computeFloatingPosition(rect: DOMRect, estimatedHeight: number, width = 320): { top: number; left: number } {
  const margin = 8;
  const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);
  const spaceBelow = window.innerHeight - rect.bottom;
  const top = spaceBelow > estimatedHeight + 12 ? rect.bottom + 6 : Math.max(margin, rect.top - estimatedHeight - 6);
  return { top, left };
}

export function ScriptEditor({
  scriptId,
  initialName = "",
  initialSteps,
  initialTags = [],
  initialVisibility = "PUBLIC",
  existingTags,
  redirectTo = "/whatsapp/scripts",
  backLabel = "Scripts",
  campaignId,
  defaultStepDelayRange,
}: {
  scriptId?: string;
  initialName?: string;
  initialSteps?: Step[];
  initialTags?: string[];
  /** Pública (padrão) = toda a organização vê e usa; Restrita = só quem criou. */
  initialVisibility?: "PUBLIC" | "PRIVATE";
  existingTags: string[];
  /** Pra onde ir depois de salvar, e o destino do link "Voltar"/"Cancelar". */
  redirectTo?: string;
  /** Texto do link "Voltar" no topo. */
  backLabel?: string;
  /** Campanha de onde a edição partiu (painel "Scripts desta campanha") — vem marcada no diálogo de salvar. */
  campaignId?: string;
  /**
   * Quando setado (ex.: [10, 25]), a 1ª mensagem e cada "Adicionar outra
   * mensagem" preenchem o delay com um valor aleatório nessa faixa em vez do
   * fixo 0/2 de hoje — só o valor inicial muda, continua editável depois
   * como qualquer campo (ver app/api/deals/bulk-send-message).
   */
  defaultStepDelayRange?: [number, number];
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">(initialVisibility);
  const [steps, setSteps] = useState<Step[]>(
    initialSteps?.length
      ? initialSteps
      : [{ text: "", delayAfterSec: defaultStepDelayRange ? randomInRange(defaultStepDelayRange) : 0 }],
  );
  // Chave estável por mensagem, independente da posição no array — sem isso,
  // remover a mensagem 1 faria a mensagem 2 "herdar" o DOM (e o innerHTML já
  // deserializado) da mensagem 1 no React, já que os editores não são mais
  // controlados por `value` a cada tecla (ver deserializeIntoEditor).
  const nextKeyRef = useRef(0);
  const newStepKey = () => `s${nextKeyRef.current++}`;
  const [stepKeys, setStepKeys] = useState<string[]>(() => steps.map(() => newStepKey()));
  const [tags, setTags] = useState<string[]>(initialTags);
  const [tagInput, setTagInput] = useState("");
  const [focusedStepIndex, setFocusedStepIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [uploadingStep, setUploadingStep] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Texto de quando a tela abriu — base pra saber se a edição mudou o que
  // chega no lead (só aí vale perguntar "correção ou nova versão?" e "aplicar
  // nas campanhas?", ver handleSubmit). Fixo de propósito: não acompanha re-renders.
  const initialStepsRef = useRef<Step[] | undefined>(initialSteps);
  const [saveDialog, setSaveDialog] = useState<{
    impact: ScriptImpactDTO;
    suggestedMode: "FIX" | "NEW_VERSION";
    suggestionNote: string;
  } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  // Pedido explícito: variação nasce DIRETO do texto que a pessoa já
  // escreveu, não de um botão separado que abre uma caixa vazia lá embaixo.
  // Fluxo: seleciona um trecho já escrito → aparece um botãozinho flutuante
  // "Variar este trecho" bem ali do lado (pendingSelection) → clica → abre o
  // popover flutuante (variationDialog) com o próprio trecho selecionado já
  // preenchido na opção 1, pedindo só as alternativas. `target` guarda ONDE
  // aplicar o resultado: "range" = substitui o trecho selecionado por uma
  // pílula nova; "chip" = reescreve uma pílula de variação já existente
  // (clicada pra editar).
  const [pendingSelection, setPendingSelection] = useState<{ stepIdx: number; range: Range; rect: DOMRect } | null>(
    null,
  );
  const [variationDialog, setVariationDialog] = useState<{
    stepIdx: number;
    options: string[];
    anchorRect: DOMRect;
    target: { type: "chip"; el: HTMLElement } | { type: "range"; range: Range };
  } | null>(null);

  const editorRefs = useRef<(HTMLDivElement | null)[]>([]);
  const initializedSteps = useRef<Set<number>>(new Set());
  const floatingButtonRef = useRef<HTMLButtonElement>(null);
  const synonymDebounceRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  // Marca qual mensagem acabou de receber um COLAR — consumido (e limpo) na
  // próxima varredura de sugestão (ver applySynonymSuggestions): colar um
  // script inteiro de uma vez merece ver TODAS as trocas possíveis, não só 2
  // aleatórias como no modo normal de digitação.
  const pastedStepsRef = useRef<Set<number>>(new Set());

  // Nunca deixa um timer de sugestão disparar depois que a tela já fechou
  // (ex.: saiu da tela no meio da janela de 900ms) — o handler já se
  // protegeria sozinho (editorRefs.current[idx] viraria null), mas não tem
  // motivo pra deixar o timer vivo à toa depois do componente desmontar.
  useEffect(
    () => () => {
      for (const timer of synonymDebounceRef.current.values()) clearTimeout(timer);
    },
    [],
  );

  // Fecha o botão flutuante "Variar este trecho" ao clicar em QUALQUER lugar
  // que não seja ele mesmo nem dentro de um editor (esse último caso já é
  // resolvido pelo próprio handleEditorSelect, chamado no mouseup de lá) —
  // sem isso, clicar no campo "Nome" ou nas tags, por exemplo, deixava o
  // botão flutuando na posição antiga, apontando pra uma seleção que já não
  // existe mais.
  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (floatingButtonRef.current?.contains(target)) return;
      if (editorRefs.current.some((el) => el?.contains(target))) return;
      setPendingSelection(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  function setEditorRef(idx: number, el: HTMLDivElement | null) {
    editorRefs.current[idx] = el;
    if (el && !initializedSteps.current.has(idx)) {
      deserializeIntoEditor(el, steps[idx]?.text ?? "");
      initializedSteps.current.add(idx);
      // Script já existente (modo "Editar") abrindo com texto pronto — sugere
      // sinônimo já de cara, sem exigir que a pessoa digite algo primeiro.
      scheduleSynonymSuggestions(idx);
    }
  }

  function updateStepText(idx: number, text: string) {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, text } : s)));
  }

  function updateStepDelay(idx: number, delayAfterSec: number) {
    const clamped = Math.min(MAX_DELAY_SEC, Math.max(0, Math.round(delayAfterSec) || 0));
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, delayAfterSec: clamped } : s)));
  }

  async function uploadStepImage(idx: number, file: File) {
    setError(null);
    setUploadingStep(idx);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const res = await fetch("/api/whatsapp/media", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.key) throw new Error(data.error ?? "Não foi possível enviar a imagem");

      const previewUrl = URL.createObjectURL(file);
      setSteps((prev) => prev.map((step, i) => (i === idx ? { ...step, type: "IMAGE", mediaUrl: data.key, previewUrl } : step)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar a imagem");
    } finally {
      setUploadingStep(null);
    }
  }

  function removeStepImage(idx: number) {
    setSteps((prev) =>
      prev.map((step, i) => (i === idx ? { ...step, type: "TEXT", mediaUrl: undefined, previewUrl: undefined } : step)),
    );
  }

  function addStep() {
    const delayAfterSec = defaultStepDelayRange ? randomInRange(defaultStepDelayRange) : 2;
    setSteps((prev) => [...prev, { text: "", delayAfterSec }]);
    setStepKeys((prev) => [...prev, newStepKey()]);
    setFocusedStepIndex(steps.length);
  }

  function removeStep(idx: number) {
    setSteps((prev) => prev.filter((_, i) => i !== idx));
    setStepKeys((prev) => prev.filter((_, i) => i !== idx));
    initializedSteps.current.delete(idx);
  }

  function handleEditorInput(idx: number) {
    const el = editorRefs.current[idx];
    if (!el) return;
    updateStepText(idx, serializeEditor(el));
    scheduleSynonymSuggestions(idx);
  }

  /** Só sugere depois que a digitação PARA — nunca no meio de uma tecla,
   * senão uma pílula nascendo no meio do texto ainda sendo escrito
   * atrapalharia o cursor. */
  function scheduleSynonymSuggestions(idx: number) {
    const existing = synonymDebounceRef.current.get(idx);
    if (existing) clearTimeout(existing);
    synonymDebounceRef.current.set(
      idx,
      setTimeout(() => applySynonymSuggestions(idx), 900),
    );
  }

  /**
   * Acha as palavras/frases do dicionário (lib/message-synonyms.ts) no texto
   * de VERDADE do editor (varre só os nós de texto puro — o conteúdo de uma
   * pílula já existente, variável ou variação, é outro nó de elemento, nunca
   * entra aqui) e insere a pilulazinha azul logo depois de cada uma. Sempre
   * limpa qualquer sugestão antiga primeiro e recalcula do zero — nunca
   * acumula sugestão de uma versão anterior do texto nem deixa uma pílula
   * "órfã" apontando pra uma palavra que já mudou.
   *
   * Modo digitação (padrão): sorteia até 2 — "palavras aleatórias mesmo"
   * (pedido explícito), nunca marca tudo de uma vez, isso poluiria a
   * mensagem de pílula azul a cada pausa na digitação. Modo colar
   * (pastedStepsRef marcado em handleEditorPaste): mostra TODAS de uma vez —
   * colar já é um evento único (a pessoa colou o script inteiro pronto), não
   * uma sequência de pausas, então não faz sentido esconder a maioria atrás
   * de sorteio.
   */
  function applySynonymSuggestions(idx: number) {
    const el = editorRefs.current[idx];
    if (!el) return;
    el.querySelectorAll("[data-synonym-key], [data-synonym-apply-all]").forEach((n) => n.remove());

    const candidates: { node: Text; start: number; end: number; text: string }[] = [];
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent ?? "";
      // matchAll (não um loop manual de .exec() com reset de .lastIndex) —
      // SYNONYM_REGEX é um único RegExp de módulo, compartilhado por toda
      // chamada; mutar .lastIndex nele seria mexer em estado global
      // compartilhado. matchAll nunca precisa disso, cuida da iteração sozinho.
      for (const m of text.matchAll(SYNONYM_REGEX)) {
        const start = m.index ?? 0;
        candidates.push({ node: node as Text, start, end: start + m[0].length, text: m[0] });
      }
    }
    if (candidates.length === 0) return;

    // Set.delete devolve se o item existia — checa E já limpa a marca numa
    // tacada só, ela só vale pra esta ÚNICA varredura pós-colar.
    const isPaste = pastedStepsRef.current.delete(idx);

    const chosen = (
      isPaste
        ? candidates
        : candidates
            .map((c) => ({ c, sort: Math.random() }))
            .sort((a, b) => a.sort - b.sort)
            .slice(0, 2)
            .map(({ c }) => c)
    )
      // Do fim do texto pro começo: dividir um nó (splitText) desloca os
      // offsets de qualquer match MAIS À FRENTE no MESMO nó — processando de
      // trás pra frente, os offsets já usados nunca mudam embaixo do próximo.
      .sort((a, b) => b.start - a.start);

    for (const c of chosen) {
      const middle = c.node.splitText(c.start);
      middle.splitText(c.end - c.start);
      const wrapper = document.createElement("span");
      wrapper.innerHTML = buildSynonymSuggestionHtml(c.text);
      middle.parentNode?.insertBefore(wrapper.firstChild!, middle.nextSibling);
    }

    // "Usar todos" só compensa com mais de uma sugestão na tela — com 1 só,
    // clicar nela direto já é tão rápido quanto.
    if (chosen.length >= 2) {
      const wrapper = document.createElement("span");
      wrapper.innerHTML = buildSynonymApplyAllHtml();
      el.appendChild(wrapper.firstChild!);
    }
  }

  /** Converte UMA pilulazinha azul de sugestão numa variação de verdade —
   * opção 1 = exatamente o que já estava escrito (data-synonym-key preserva
   * a maiúscula original), o resto vem do dicionário. Usado tanto no clique
   * individual quanto no "usar todos" (ver handleEditorClick). */
  function applySynonymChip(chip: HTMLElement) {
    const matchedText = chip.dataset.synonymKey ?? "";
    const options = [matchedText, ...synonymsFor(matchedText)].filter(Boolean);
    // O nó de texto da palavra em si é sempre o irmão IMEDIATAMENTE anterior
    // à pílula — foi cortado bem ali por applySynonymSuggestions, nunca
    // sobra nada entre os dois.
    const wordNode = chip.previousSibling;
    const wrapper = document.createElement("span");
    wrapper.innerHTML = buildVariationChipHtml(options);
    chip.replaceWith(wrapper.firstChild!);
    if (wordNode instanceof Text) wordNode.remove();
  }

  function handleEditorKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    document.execCommand("insertLineBreak");
  }

  function handleEditorPaste(e: React.ClipboardEvent<HTMLDivElement>, idx: number) {
    // Sempre como texto puro — colar de um site/Word traria formatação/HTML
    // estranho pro corpo da mensagem.
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    // NUNCA insertText com o texto de várias linhas cru: pra cada "\n" o
    // navegador aplica o MESMO parágrafo padrão do Enter (defaultParagraphSeparator)
    // e embrulha cada linha num <div> novo — a armadilha que handleEditorKeyDown
    // já contorna pro Enter, mas que insertText não evita sozinho. Isso deixava
    // o texto colado ANINHADO (texto dentro de <div>, não filho direto da
    // raiz do editor) e invisível pra applySynonymSuggestions, que só varre
    // childNodes de texto diretos — colar um script de várias linhas não
    // sugeria nada. Monta HTML já achatado (texto + <br>, sem <div>) — mesma
    // estrutura que o Enter já produz — escapando o texto antes (insertHTML
    // interpretaria "<"/"&" do que foi colado como tag/entidade de verdade).
    document.execCommand(
      "insertHTML",
      false,
      // \r\n (Windows) e \r solto (Mac clássico) primeiro viram \n puro —
      // senão sobra um \r perdido no meio do texto (visível ou não).
      escapeHtml(text.replace(/\r\n?/g, "\n")).replace(/\n/g, "<br>"),
    );
    // Consumido na próxima varredura (ver applySynonymSuggestions) — colar
    // mostra TODAS as trocas possíveis de uma vez, não só 2 aleatórias.
    pastedStepsRef.current.add(idx);
  }

  /** Clique numa pílula: variável remove direto; variação existente abre o popover flutuante pra editar (ou remove, se foi no "×"). */
  function handleEditorClick(e: React.MouseEvent<HTMLDivElement>, idx: number) {
    const target = e.target as HTMLElement;

    const removeBtn = target.closest<HTMLElement>("[data-variation-remove]");
    if (removeBtn) {
      removeBtn.closest<HTMLElement>("[data-variation-options]")?.remove();
      handleEditorInput(idx);
      return;
    }

    const variationChip = target.closest<HTMLElement>("[data-variation-options]");
    if (variationChip) {
      const options: string[] = JSON.parse(decodeURIComponent(variationChip.dataset.variationOptions!));
      setPendingSelection(null);
      setVariationDialog({
        stepIdx: idx,
        options,
        anchorRect: variationChip.getBoundingClientRect(),
        target: { type: "chip", el: variationChip },
      });
      return;
    }

    const tokenChip = target.closest<HTMLElement>("[data-token]");
    if (tokenChip) {
      tokenChip.remove();
      handleEditorInput(idx);
    }

    // Clique na pilulazinha azul de sugestão: a palavra clicada vira
    // variação de verdade (ver applySynonymChip).
    const synonymChip = target.closest<HTMLElement>("[data-synonym-key]");
    if (synonymChip) {
      applySynonymChip(synonymChip);
      handleEditorInput(idx);
      return;
    }

    // Clique em "usar todos": mesma conversão, só que pra CADA pilulazinha
    // azul ainda na tela de uma vez — a pílula "usar todos" é sempre filha
    // direta da raiz do editor (ver applySynonymSuggestions/el.appendChild),
    // então basta olhar os irmãos dela.
    const applyAllChip = target.closest<HTMLElement>("[data-synonym-apply-all]");
    if (applyAllChip) {
      const root = applyAllChip.parentElement;
      const pills = Array.from(root?.querySelectorAll<HTMLElement>("[data-synonym-key]") ?? []);
      for (const pill of pills) applySynonymChip(pill);
      applyAllChip.remove();
      handleEditorInput(idx);
    }
  }

  /** Insere a pílula da variável no editor que estava com foco por último, na posição do cursor. */
  function insertVariable(bracedToken: string) {
    const idx = focusedStepIndex;
    const el = editorRefs.current[idx];
    if (!el) return;
    const token = bracedToken.replace(/[{}]/g, "");
    ensureFocusInsideEditor(el);
    document.execCommand("insertHTML", false, buildChipHtml(token));
    handleEditorInput(idx);
  }

  /**
   * Roda a cada solta-do-mouse/tecla dentro de um editor — detecta se sobrou
   * uma SELEÇÃO DE TEXTO de verdade (não um clique/cursor simples) pra
   * mostrar o botão flutuante "Variar este trecho" bem ao lado dela. Nunca
   * ativa em cima de uma seleção que já inclui pílula (variável ou variação)
   * — o texto VISÍVEL de uma pílula não é o valor real por trás dela
   * ({cargo}, ou as opções já salvas), então virar isso em variação nova
   * criaria uma variação com o RÓTULO errado.
   */
  function handleEditorSelect(idx: number) {
    const el = editorRefs.current[idx];
    const sel = window.getSelection();
    if (!el || !sel || sel.isCollapsed || sel.rangeCount === 0) {
      setPendingSelection((prev) => (prev?.stepIdx === idx ? null : prev));
      return;
    }
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;
    if (range.cloneContents().querySelector("[data-token], [data-variation-options]")) return;
    if (!range.toString().trim()) return;
    setPendingSelection({ stepIdx: idx, range: range.cloneRange(), rect: range.getBoundingClientRect() });
  }

  /** Botão flutuante "Variar este trecho": abre o popover com o próprio trecho selecionado já na opção 1. */
  function openVariationFromSelection() {
    if (!pendingSelection) return;
    const { stepIdx, range, rect } = pendingSelection;
    setVariationDialog({ stepIdx, options: [range.toString().trim(), ""], anchorRect: rect, target: { type: "range", range } });
    setPendingSelection(null);
  }

  /** Confirma o popover: reescreve a pílula existente (edição), ou substitui o trecho selecionado por uma pílula nova. */
  function saveVariationDialog(options: string[]) {
    if (!variationDialog) return;
    const { stepIdx, target } = variationDialog;
    const el = editorRefs.current[stepIdx];
    if (!el) {
      setVariationDialog(null);
      return;
    }

    if (target.type === "chip" && el.contains(target.el)) {
      const encoded = encodeURIComponent(JSON.stringify(options));
      target.el.setAttribute("data-variation-options", encoded);
      target.el.innerHTML = `🔀 ${escapeHtml(options.join(" / "))}<span data-variation-remove="true" class="variation-pill__remove" title="Remover variação">×</span>`;
    } else if (target.type === "range") {
      // Restaura a seleção original (o range continua válido mesmo com o
      // foco/seleção "de verdade" já tendo saído pra dentro do popover) e
      // deixa o insertHTML SUBSTITUIR o trecho, mesmo mecanismo de sempre.
      el.focus();
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(target.range);
      document.execCommand("insertHTML", false, buildVariationChipHtml(options));
    }
    handleEditorInput(stepIdx);
    setVariationDialog(null);
  }

  function addTag(raw: string) {
    const clean = raw.trim();
    if (!clean || tags.includes(clean)) {
      setTagInput("");
      return;
    }
    setTags((prev) => [...prev, clean]);
    setTagInput("");
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag));
  }

  // Memoizado pela chave dos textos crus, não recalculado a cada render: como
  // a variação sorteia uma opção ao acaso (expandSpintax), recalcular à toa
  // (ex.: digitando em outro campo qualquer) reiniciaria a animação do
  // celular sem a mensagem ter mudado de verdade.
  const rawStepsKey = steps.map((s) => `${s.type ?? "TEXT"}:${s.mediaUrl ?? ""}:${s.text}`).join("");
  const [variationSeed, setVariationSeed] = useState(0);
  const hasVariation = steps.some((s) => /\{\[[^[\]]+\]\}/.test(s.text));
  const previewSteps = useMemo(
    () =>
      steps.map((s) => ({
        text: s.text.trim() ? renderTemplate(s.text, SAMPLE_VARS, "Boa tarde") : "",
        delayAfterSec: s.delayAfterSec,
        type: s.type,
        imagePreviewUrl: s.previewUrl,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawStepsKey, variationSeed],
  );
  const totalChars = steps.reduce((sum, s) => sum + s.text.length, 0);
  const canSubmit = !!name.trim() && steps.length > 0 && steps.every((s) => s.text.trim().length > 0 && (s.type !== "IMAGE" || !!s.mediaUrl));

  /** Grava o script (POST novo / PUT existente). `choice` só existe depois do diálogo de salvar. Devolve a mensagem de erro, ou null se deu certo. */
  async function persist(choice?: ScriptSaveChoice): Promise<string | null> {
    try {
      const res = await fetch(scriptId ? `/api/message-scripts/${scriptId}` : "/api/message-scripts", {
        method: scriptId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, steps, tags, visibility, ...(choice ?? {}) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return data.error ?? "Erro ao salvar script";
      }
    } catch {
      return "Falha de conexão. Tente novamente.";
    }
    router.push(redirectTo);
    router.refresh();
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Script novo, ou edição que não mexeu no texto/intervalos (só nome, tags,
    // visibilidade) → salva direto, sem perguntar nada.
    const textChanged = !!scriptId && normalizeSteps(steps) !== normalizeSteps(initialStepsRef.current);
    if (textChanged) {
      // "O que essa edição afeta?" — só pergunta algo se o script já foi
      // enviado (correção × nova versão) ou se há campanha ativa usando ele.
      let impact: ScriptImpactDTO | null = null;
      try {
        const res = await fetch(`/api/message-scripts/${scriptId}/impact`);
        if (res.ok) impact = await res.json();
      } catch {
        // cai no erro logo abaixo
      }
      if (!impact) {
        setLoading(false);
        setError("Não foi possível verificar as campanhas que usam este script. Tente salvar de novo.");
        return;
      }
      if (impact.hasHistory || impact.campaigns.length > 0) {
        const ratio = textChangeRatio(initialStepsRef.current, steps);
        const percent = Math.max(1, Math.round(ratio * 100));
        setDialogError(null);
        setSaveDialog({
          impact,
          suggestedMode: ratio >= NEW_VERSION_SUGGESTION_RATIO ? "NEW_VERSION" : "FIX",
          suggestionNote:
            ratio === 0
              ? "só mudou o intervalo entre as mensagens"
              : ratio >= NEW_VERSION_SUGGESTION_RATIO
                ? `cerca de ${percent}% do texto mudou`
                : `mudança pequena (~${percent}% do texto)`,
        });
        setLoading(false);
        return;
      }
    }

    const failure = await persist();
    if (failure) {
      setLoading(false);
      setError(failure);
    }
  }

  async function confirmSaveDialog(choice: ScriptSaveChoice) {
    setLoading(true);
    setDialogError(null);
    const failure = await persist(choice);
    if (failure) {
      setLoading(false);
      setDialogError(failure);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link
        href={redirectTo}
        className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
        {backLabel}
      </Link>

      <div>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          {scriptId ? "Editar script" : "Novo script"}
        </h1>
        <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
          Defina o texto, as variáveis e o intervalo entre mensagens — a prévia ao lado mostra exatamente como vai
          chegar pro lead.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="card space-y-3 p-4">
          <div className="space-y-1">
            <label className="field-label">Nome</label>
            <input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Abertura — cargo jurídico"
              className="field-input"
            />
          </div>

          <div className="space-y-1">
            <label className="field-label">Tags</label>
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => removeTag(t)}
                    className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                    aria-label={`Remover tag ${t}`}
                  >
                    <X className="h-3 w-3" strokeWidth={2} />
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag(tagInput);
                  }
                }}
                onBlur={() => tagInput && addTag(tagInput)}
                list="existing-script-tags"
                placeholder="Adicionar tag..."
                className="field-input w-48 py-1 text-xs"
              />
              <datalist id="existing-script-tags">
                {existingTags
                  .filter((t) => !tags.includes(t))
                  .map((t) => (
                    <option key={t} value={t} />
                  ))}
              </datalist>
            </div>
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              Organiza a biblioteca — ex.: &quot;abertura&quot;, &quot;follow-up&quot;, &quot;objeção&quot;.
            </p>
          </div>

          <div className="space-y-1">
            <label className="field-label">Visibilidade</label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setVisibility("PUBLIC")}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  visibility === "PUBLIC"
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-neutral-300 text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                }`}
              >
                <Globe2 className="h-3.5 w-3.5" strokeWidth={2} />
                Pública
              </button>
              <button
                type="button"
                onClick={() => setVisibility("PRIVATE")}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  visibility === "PRIVATE"
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-neutral-300 text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                }`}
              >
                <Lock className="h-3.5 w-3.5" strokeWidth={2} />
                Restrita
              </button>
            </div>
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              {visibility === "PUBLIC"
                ? "Toda a organização vê e pode usar este script."
                : "Só você (e o dono da organização) vê e pode usar este script."}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
          <div className="space-y-3 lg:col-span-7">
            {/* Cabeçalho do fluxo — pílulas de variável globais, não mais por
                mensagem: inserem sempre na mensagem com foco (ver
                insertVariable/focusedStepIndex), então não precisam mais
                "seguir" o card ativo lá embaixo. */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200/60 bg-neutral-50/60 px-4 py-3 dark:border-neutral-800/60 dark:bg-neutral-900/40">
              <div className="flex items-center gap-2">
                <MessageCircleMore className="h-4 w-4 text-brand" strokeWidth={2.5} />
                <h2 className="text-xs font-semibold tracking-wide text-neutral-700 uppercase dark:text-neutral-200">
                  Fluxo de mensagens
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500">Inserir:</span>
                <VariablePills onInsert={insertVariable} />
              </div>
            </div>

            {steps.map((step, idx) => {
              return (
                <div key={stepKeys[idx]} className="flex gap-3">
                  {/* Selo numerado + linha conectando ao próximo passo — o
                      mesmo fio visual continua até o botão "adicionar passo"
                      no fim da lista (ver abaixo), pra ler como um fluxo só,
                      não cards soltos. */}
                  <div className="flex w-7 shrink-0 flex-col items-center">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white shadow-sm">
                      {idx + 1}
                    </span>
                    <span className="mt-1 w-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
                  </div>

                  <div className="card flex-1 overflow-hidden p-0">
                    <div className="space-y-2 p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                          {idx === 0 ? "Mensagem principal" : `Mensagem ${idx + 1}`}
                        </span>
                        {steps.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeStep(idx)}
                            className="icon-btn"
                            aria-label={`Remover mensagem ${idx + 1}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                          </button>
                        )}
                      </div>
                      {step.type === "IMAGE" ? (
                        <div className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-2.5 dark:border-neutral-800 dark:bg-neutral-900/60">
                          {step.previewUrl ? (
                            <img src={step.previewUrl} alt="Imagem do script" className="h-14 w-14 rounded-md object-cover" />
                          ) : (
                            <div className="flex h-14 w-14 items-center justify-center rounded-md bg-neutral-200 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                              <ImageIcon className="h-5 w-5" strokeWidth={2} />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">Imagem adicionada</p>
                            <p className="text-xs text-neutral-500 dark:text-neutral-400">A mensagem abaixo será enviada como legenda.</p>
                          </div>
                          <button type="button" onClick={() => removeStepImage(idx)} className="icon-btn shrink-0" aria-label={`Remover imagem da mensagem ${idx + 1}`}>
                            <X className="h-3.5 w-3.5" strokeWidth={2} />
                          </button>
                        </div>
                      ) : (
                        <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-600 dark:hover:bg-neutral-800">
                          {uploadingStep === idx ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <ImagePlus className="h-3.5 w-3.5" strokeWidth={2} />}
                          {uploadingStep === idx ? "Enviando imagem" : "Adicionar imagem"}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="sr-only"
                            disabled={uploadingStep !== null}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.currentTarget.value = "";
                              if (file) void uploadStepImage(idx, file);
                            }}
                          />
                        </label>
                      )}
                      <div className="relative">
                        <div
                          ref={(el) => setEditorRef(idx, el)}
                          contentEditable
                          suppressContentEditableWarning
                          onFocus={() => setFocusedStepIndex(idx)}
                          onInput={() => handleEditorInput(idx)}
                          onKeyDown={handleEditorKeyDown}
                          onPaste={(e) => handleEditorPaste(e, idx)}
                          onClick={(e) => handleEditorClick(e, idx)}
                          onMouseUp={() => handleEditorSelect(idx)}
                          onKeyUp={() => handleEditorSelect(idx)}
                          className="field-input scrollbar-thin min-h-[4.5rem] cursor-text overflow-y-auto pr-8 whitespace-pre-wrap"
                        />
                        {!step.text && (
                          <span className="pointer-events-none absolute top-2 left-3 text-sm text-neutral-400 dark:text-neutral-500">
                            Ex.: {"{saudacao} {primeiro_nome}"}! Vi que você atua como {"{cargo}"}...
                          </span>
                        )}
                        {/* Só um afago visual — o campo já é editável clicando em
                            qualquer lugar (contentEditable); isso aqui só dá o
                            lembrete de "dá pra editar" sem precisar de texto extra. */}
                        <button
                          type="button"
                          tabIndex={-1}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => editorRefs.current[idx]?.focus()}
                          className="icon-btn absolute right-1.5 bottom-1.5 h-6 w-6"
                          aria-label={`Editar mensagem ${idx + 1}`}
                        >
                          <Pencil className="h-3 w-3" strokeWidth={2} />
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-neutral-400 dark:text-neutral-500">
                        <span className="shrink-0">{step.text.length} caracteres</span>
                        {idx < steps.length - 1 && (
                          <label className="flex flex-wrap items-center gap-1.5">
                            Esperar
                            <input
                              type="number"
                              min={0}
                              max={MAX_DELAY_SEC}
                              value={step.delayAfterSec}
                              onChange={(e) => updateStepDelay(idx, Number(e.target.value))}
                              className="field-input w-16 shrink-0 px-2 py-0.5"
                            />
                            segundos antes da próxima mensagem
                          </label>
                        )}
                      </div>
                      {/* Pedido explícito: variação nasce direto de um
                          trecho que a pessoa já escreveu (seleciona o texto,
                          aparece um botão "Variar este trecho" ali do lado —
                          ver handleEditorSelect), não de uma seção separada
                          embaixo. Esta dica é só pra ensinar o gesto na
                          primeira vez; some sozinha quando a mensagem já tem
                          alguma variação (🔀) dentro. */}
                      {!/\{\[[^[\]]+\]\}/.test(step.text) && (
                        <p className="flex items-center gap-1.5 text-[11px] text-neutral-400 dark:text-neutral-500">
                          <Shuffle className="h-3 w-3 shrink-0 text-violet-400 dark:text-violet-500" strokeWidth={2} />
                          Selecione um trecho do texto acima pra variar como ele é dito (ex.: &quot;Tudo bem?&quot;).
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="flex gap-3">
              <div className="flex w-7 shrink-0 justify-center">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-neutral-300 text-neutral-400 dark:border-neutral-700 dark:text-neutral-500">
                  <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                </span>
              </div>
              <button
                type="button"
                onClick={addStep}
                className="flex flex-1 items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 py-2.5 text-xs font-medium text-neutral-400 transition-colors hover:border-neutral-400 hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:border-neutral-700 dark:text-neutral-500 dark:hover:border-neutral-600 dark:hover:text-neutral-300"
              >
                Adicionar próximo passo no fluxo
              </button>
            </div>

            {/* Botão flutuante "Variar este trecho" — aparece bem ao lado do
                texto selecionado (ver handleEditorSelect/pendingSelection).
                Portal pro body: precisa escapar do overflow do `.card` e
                ficar por cima de tudo, `position:fixed` com coordenadas de
                tela (não relativas a nenhum container). */}
            {pendingSelection &&
              typeof document !== "undefined" &&
              createPortal(
                (() => {
                  const pos = computeFloatingPosition(pendingSelection.rect, 40, 180);
                  return (
                    <button
                      ref={floatingButtonRef}
                      type="button"
                      onClick={openVariationFromSelection}
                      style={{ top: pos.top, left: pos.left }}
                      className="fixed z-[70] inline-flex animate-pop-in items-center gap-1.5 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-medium text-violet-700 shadow-lg hover:bg-violet-50 dark:border-violet-500/30 dark:bg-neutral-900 dark:text-violet-300 dark:hover:bg-violet-500/10"
                    >
                      <Shuffle className="h-3.5 w-3.5" strokeWidth={2.5} />
                      Variar este trecho
                    </button>
                  );
                })(),
                document.body,
              )}

            {/* Popover flutuante do editor de variação — mesmo componente de
                sempre (MessageVariationEditor), só que agora aparece ancorado
                perto do trecho selecionado (ou da pílula clicada pra editar)
                em vez de fixo numa seção do card. */}
            {variationDialog &&
              typeof document !== "undefined" &&
              createPortal(
                (() => {
                  const pos = computeFloatingPosition(variationDialog.anchorRect, 260);
                  return (
                    <div
                      style={{ top: pos.top, left: pos.left }}
                      className="fixed z-[70] w-80 max-w-[calc(100vw-16px)] animate-pop-in rounded-md shadow-xl"
                    >
                      <MessageVariationEditor
                        initialOptions={variationDialog.options}
                        onCancel={() => setVariationDialog(null)}
                        onSave={saveVariationDialog}
                      />
                    </div>
                  );
                })(),
                document.body,
              )}
          </div>

          <div className="card relative space-y-3 overflow-hidden p-4 lg:sticky lg:top-4 lg:col-span-5">
            <div className="pointer-events-none absolute top-1/2 left-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/5 blur-[80px]" />
            <p className="field-label relative z-10 text-center">Prévia (com dados de exemplo)</p>
            <div className="relative z-10">
              <WhatsAppPhonePreview steps={previewSteps} contactName={SAMPLE_VARS.nome} />
            </div>
            {hasVariation && (
              <button
                type="button"
                onClick={() => setVariationSeed((s) => s + 1)}
                className="relative z-10 mx-auto flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 transition-colors hover:border-violet-300 hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/20"
              >
                <Shuffle className="h-3 w-3" strokeWidth={2.5} />
                Ver outra variação
              </button>
            )}
            <p className="text-center text-xs text-neutral-400 dark:text-neutral-500">{totalChars} caracteres no total</p>
          </div>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pb-4">
          <Link href={redirectTo} className="btn-ghost">
            Cancelar
          </Link>
          <button type="submit" disabled={loading || !canSubmit} className="btn-primary">
            {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {loading ? (
              <span className="inline-flex items-center gap-1">
                Salvando
                <LoadingDots />
              </span>
            ) : (
              "Salvar"
            )}
          </button>
        </div>
      </form>

      {saveDialog && (
        <ScriptSaveDialog
          impact={saveDialog.impact}
          suggestedMode={saveDialog.suggestedMode}
          suggestionNote={saveDialog.suggestionNote}
          preselectCampaignId={campaignId}
          saving={loading}
          error={dialogError}
          onCancel={() => setSaveDialog(null)}
          onConfirm={confirmSaveDialog}
        />
      )}
    </div>
  );
}
