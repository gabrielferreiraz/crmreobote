/**
 * Mensagem de erro de UM campo, ligada ao input por `aria-describedby` (o leitor
 * de tela lê o erro junto com o campo) e `role="alert"` (anunciada assim que
 * aparece). O visual vem de `.field-error` em app/globals.css; o input/select
 * inválido leva `aria-invalid="true"` (`.field-input[aria-invalid]`).
 *
 * Por que existe (relatório de QA, achado M3): "Criar" ficava DESABILITADO em
 * silêncio quando faltava campo obrigatório — clicar não fazia nada e ninguém
 * sabia o que faltava. O padrão novo: botão sempre clicável, valida ao enviar,
 * mostra o erro NO campo e leva o foco pro primeiro inválido.
 */
export function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="field-error">
      {children}
    </p>
  );
}

/** Foca o primeiro campo inválido (por id) — o navegador rola até ele sozinho. Sem id achado, não faz nada. */
export function focusField(id: string | undefined) {
  if (!id || typeof document === "undefined") return;
  document.getElementById(id)?.focus();
}
