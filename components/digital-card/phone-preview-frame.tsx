/**
 * Moldura de celular pra pré-visualização em "Meu Cartão" — pedido
 * explícito do usuário ("ficou esquisito a pré-visualização, pode colocar
 * em um celular mesmo"): o cartão encolhido dentro de uma coluna estreita
 * de configurações não passava a sensação real de como ele fica; dentro de
 * uma moldura de celular fica óbvio que É uma tela de celular, do mesmo
 * jeito que o visitante vai ver de verdade. Só usada aqui — a página
 * pública de verdade (app/c/[slug]/page.tsx) não tem moldura nenhuma,
 * porque ali JÁ é a tela real do celular do visitante.
 */
export function PhonePreviewFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[300px]">
      <div className="relative rounded-[2.5rem] bg-neutral-900 p-2 shadow-xl dark:bg-black">
        {/* Notch */}
        <div className="absolute left-1/2 top-2 z-10 h-4 w-24 -translate-x-1/2 rounded-full bg-neutral-900 dark:bg-black" />
        <div className="relative max-h-[620px] overflow-y-auto overflow-x-hidden rounded-[2rem] bg-[#0a0b10]">
          <div className="px-3 pb-6 pt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
