import type { ReactNode } from "react";

/**
 * Moldura visual da tela de kiosk da TV — extraída de app/tv/layout.tsx pra
 * poder ser reaproveitada também por app/t/[code]/page.tsx (o link público
 * curto, ver lib/tv-display-link.ts), que fica FORA do segmento /tv/* de
 * propósito (rota o mais curta possível pra digitar no controle remoto —
 * "/t/CÓDIGO" em vez de "/tv/p/CÓDIGO"), então não herda app/tv/layout.tsx
 * automaticamente. Sempre escura — não segue o toggle claro/escuro do resto
 * do app (não tem usuário ali pra alternar, é uma tela ligada na parede).
 */
export function TvShell({ children }: { children: ReactNode }) {
  return (
    <div className="tv-gradient-bg dark relative h-screen w-screen overflow-hidden text-white">
      {/* Moldura de segurança contra overscan (ver --tv-safe-margin em
          globals.css) — fica NESTE wrapper interno, não no fundo (acima),
          de propósito: o gradiente de fundo precisa continuar cobrindo a
          tela inteira (se o painel da TV cortar uma faixa da borda, quem
          sobra visível ali ainda é fundo, nunca uma tarja preta/vazia
          diferente do resto). */}
      <div className="absolute inset-0" style={{ padding: "var(--tv-safe-margin)" }}>
        {/* CANVAS de composição — ocupa a área segura de ponta a ponta nos
            dois eixos (h-full w-full, sem letterbox, sem sobra nenhuma nas
            laterais) — uma TV real É a proporção de referência (16:9, ver
            lib/tv-display-profile.ts), então aqui não existe conflito
            nenhum pra resolver. `container-type: size` é o que faz esta
            div virar a ÚNICA referência que todo token `--tv-*` cq* (ver
            app/globals.css e tv-view.tsx) enxerga — `cqw` sempre mede a
            largura REAL desta caixa (edge-to-edge com a tela), `cqh` a
            altura REAL dela, cada eixo correto por conta própria. Antes
            existiam DOIS contextos de medida diferentes (tokens fora do
            bloco de cards contra a tela crua, tokens de dentro contra um
            sub-contêiner aninhado) — era essa divergência entre dois
            "relógios" que descolava painel/banner um do outro numa janela
            de teste fora de 16:9, não a ausência de um canvas travado. Com
            um único contêiner pra tudo, cada eixo já é internamente
            consistente sem precisar forçar um formato de moldura por
            cima. */}
        <div style={{ containerType: "size", containerName: "tv-canvas" } as React.CSSProperties} className="h-full w-full">
          {children}
        </div>
      </div>
    </div>
  );
}
