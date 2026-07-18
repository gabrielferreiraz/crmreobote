"use client";

const VARIABLES: { token: string; label: string }[] = [
  { token: "{nome}", label: "Nome" },
  { token: "{primeiro_nome}", label: "1º nome" },
  { token: "{cargo}", label: "Cargo" },
  { token: "{empresa}", label: "Empresa" },
  { token: "{cidade}", label: "Cidade" },
  { token: "{consultor}", label: "Consultor" },
  { token: "{saudacao}", label: "Saudação" },
];

/** Botões estilo "pílula" que inserem a variável no campo de texto focado (ver ScriptEditor.insertVariable). */
export function VariablePills({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {VARIABLES.map((v) => (
        <button
          key={v.token}
          type="button"
          // mousedown com preventDefault (não onClick) evita que o navegador tire o
          // foco/seleção do editor da mensagem antes do clique — sem isso, a posição
          // do cursor "lembrada" pelo contentEditable se perde e a variável não sabe
          // onde entrar (ver ScriptEditor.insertVariable/ensureFocusInsideEditor).
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInsert(v.token)}
          title={`Inserir ${v.token}`}
          className="rounded-full border border-neutral-300 bg-neutral-50 px-2.5 py-1 text-xs font-medium text-neutral-600 transition-colors hover:border-neutral-900 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:border-white dark:hover:text-white"
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
