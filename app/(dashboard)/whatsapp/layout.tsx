import { WhatsAppSubNav } from "./whatsapp-subnav";

/** Conversas, Campanhas e Scripts moram todos sob uma aba só no menu — separados aqui por sub-navegação em vez de 3 itens no menu de cima. */
export default function WhatsAppLayout({ children }: { children: React.ReactNode }) {
  return (
    // min-h-0: sem isso, o filho h-full/flex-1 de baixo (min-h-0 flex-1 na
    // linha seguinte) não tem uma altura definida de verdade pra herdar — o
    // efeito nunca aparecia aqui sozinho, só se via na ponta da cadeia
    // (Conversas crescendo pro tamanho de todas as mensagens e fazendo a
    // PÁGINA inteira rolar, em vez de só a lista por dentro — mesmo ajuste
    // de pipeline-view.tsx/processes-view.tsx).
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Sem título "WhatsApp" repetido aqui — o menu de cima já destaca o
          item ativo (mesmo espírito do WhatsApp de verdade, que também não
          reafirma o próprio nome dentro do app). Menos uma linha de altura
          antes do painel de conversas começar, que é o que devia dominar a
          tela — igual ao WhatsApp de verdade, quase nada de "moldura" acima
          da lista + chat. */}
      <div className="shrink-0">
        <WhatsAppSubNav />
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
