"use client";

import { usePathname } from "next/navigation";

/**
 * Telas que já implementam a própria rolagem interna completa, de ponta a
 * ponta (cada painel — lista, kanban, chat — com seu próprio scroll, numa
 * altura travada em h-full/min-h-0 até aqui em cima). Pra essas, deixar o
 * <main> tentar rolar TAMBÉM é redundante na melhor das hipóteses — e na
 * pior, com tantas camadas de flexbox empilhadas (layout > sub-nav > página
 * > painel > lista), sobra sempre um resto de poucos pixels de
 * arredondamento entre uma camada e outra que É overflow de verdade, e isso
 * já bastava pra <main> ativar sua própria barra e a "página inteira" se
 * mexer por cima do que devia ser um app de tela fixa (ver conversa que
 * motivou isso, na tela de WhatsApp → Conversas).
 *
 * Correndo atrás de qual exata camada estava com aquele resto de pixel a
 * mais era caça alta e frágil (qualquer ajuste futuro de padding/gap podia
 * reintroduzir o mesmo sintoma); mais robusto é <main> simplesmente nunca
 * rolar nessas rotas — o filho h-full já preenche o espaço certo sozinho, e
 * qualquer resto de arredondamento vira `overflow-hidden` (invisível) em vez
 * de virar uma barra de rolagem visível.
 */
const APP_SHELL_ROUTES = ["/whatsapp/conversas", "/processos", "/pipeline"];

// Pipeline é um quadro Kanban de colunas de largura fixa que rolam na
// horizontal — o teto de 1500px (bom pra texto/formulário não esticar
// demais) só cortava colunas inteiras pra dentro do scroll horizontal à toa
// em monitor largo, sobrando uma faixa vazia enorme do lado. Sem teto aqui,
// a fileira de colunas usa a largura de verdade disponível (px-4 lg:px-8 no
// <main>, abaixo, já dá a moldura responsiva das bordas). Conversas/Processos
// não pediram isso ainda — Conversas já gerencia a própria largura via
// painéis redimensionáveis, então ficam de fora por ora.
const FULL_WIDTH_ROUTES = ["/pipeline"];

export function AppMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAppShell = APP_SHELL_ROUTES.some((route) => pathname === route);
  const isFullWidth = FULL_WIDTH_ROUTES.some((route) => pathname === route);

  return (
    <main
      className={`flex-1 overflow-x-hidden px-4 pt-4 lg:px-8 lg:pt-8 ${
        isAppShell
          ? // Sem overflow-y-auto NEM scrollbar-gutter aqui — não tem scroll
            // nenhum pra reservar espaço, então reservar só criava uma faixa
            // vazia do lado (ver mesma conversa) sem nunca ter conteúdo pra
            // rolar de verdade.
            //
            // pb pequeno (não o pb-28 de baixo) — o motivo do pb-28 nas
            // páginas normais é sobrar rodapé visível numa página que ROLA
            // (ver comentário abaixo); aqui o painel é de altura fixa
            // (h-full até aqui em cima), então aquele respiro gigante só
            // cortava a parte de baixo do painel à toa, sem servir pra nada
            // — pb pequeno é só a moldura/respiro visual mesmo.
            "overflow-y-hidden pb-3 lg:pb-4"
          : // scrollbar-gutter reserva o espaço da barra de rolagem o tempo
            // todo — sem isso, trocar o filtro de período no Relatórios (ou
            // qualquer outra navegação que mude a altura do conteúdo) faz a
            // barra aparecer/sumir e o conteúdo inteiro "pular" alguns
            // pixels pro lado.
            //
            // pb-28 (96px+) sempre, em qualquer tamanho de tela — já
            // tentamos um `lg:pb-8` (32px) menor no desktop pra "economizar"
            // espaço, mas isso fazia toda página comum (Relatórios,
            // Configurações, Clientes, Início) voltar a ficar com o último
            // elemento colado na borda da janela — o problema real e
            // recorrente. Nunca reduza esse valor no desktop de novo sem
            // confirmar que o rodapé de uma página comprida (ex.:
            // Configurações) sobra visível.
            "overflow-y-auto pb-28 [scrollbar-gutter:stable] lg:pb-24"
      }`}
    >
      <div className={`mx-auto h-full w-full ${isFullWidth ? "" : "max-w-[1500px]"}`}>{children}</div>
    </main>
  );
}
