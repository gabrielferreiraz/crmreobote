"use client";

import { useRef, useState } from "react";

/**
 * Arrastar-e-soltar um arquivo sobre uma área (drop zone) — extraído pra cá
 * porque os diálogos de importação (Contatos e Negócios) tinham a MESMA
 * área de "clique pra escolher arquivo" sem suporte a arrastar (pedido
 * explícito, "importar contatos deve ser drag and drop"). Devolve os
 * handlers pra plugar na área + se tem um arquivo sendo arrastado por cima
 * agora (pra destacar visualmente) — continua funcionando por clique
 * normal também, isto só ACRESCENTA o arraste.
 *
 * `dragCounter` (não um booleano só, ligado/desligado direto em
 * dragenter/dragleave) porque o navegador dispara um PAR de
 * dragenter/dragleave pra cada elemento FILHO que o cursor passa por cima
 * (o ícone, o texto, etc., dentro da mesma área) — sem contar, o destaque
 * "pisca" apagando toda vez que o cursor cruza a borda de um filho, mesmo
 * ainda dentro da área como um todo.
 */
export function useFileDrop(onFile: (file: File) => void, disabled?: boolean) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounter = useRef(0);

  function onDragEnter(e: React.DragEvent) {
    e.preventDefault();
    if (disabled) return;
    dragCounter.current += 1;
    setIsDraggingOver(true);
  }

  function onDragOver(e: React.DragEvent) {
    // preventDefault aqui TAMBÉM (não só no dragenter) — sem isso o
    // navegador nunca permite soltar, onDrop simplesmente não dispara; é o
    // próprio padrão da Drag and Drop API do navegador, não um detalhe
    // opcional daqui.
    e.preventDefault();
  }

  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    if (disabled) return;
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDraggingOver(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDraggingOver(false);
    if (disabled) return;
    // Só o 1º arquivo — mesma regra de sempre destes diálogos (um arquivo
    // por importação, ver <input type="file"> sem `multiple`). Tipo/tamanho
    // errado não precisa de checagem aqui: a mesma análise no servidor que
    // já rejeita isso pro clique normal (ver runPreview) cobre igual pro
    // arraste, sem duplicar validação nenhuma.
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) onFile(droppedFile);
  }

  return { isDraggingOver, dropZoneProps: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
