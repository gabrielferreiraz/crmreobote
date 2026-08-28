"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Substitui a abordagem anterior de "adivinhar o tamanho da TV" (clamp()
 * em vmin, calibrado à mão pra uma resolução de referência, quebrando toda
 * vez que a TV real era outra) por RESPONSIVIDADE DE VERDADE: o conteúdo é
 * desenhado numa largura fixa "de design" (`designWidth`, valores já
 * testados/aprovados — os mesmos que existiam antes de qualquer tentativa
 * de calibrar em vmin), e este componente MEDE de verdade (ResizeObserver,
 * não estimativa) o espaço disponível e a altura natural do conteúdo, e
 * aplica um `transform: scale()` que faz esse bloco caber EXATAMENTE no
 * espaço dado — nunca cortado (nunca maior que o espaço disponível), nunca
 * pequeno demais à toa (sempre cresce até o limite que a tela permitir).
 * Funciona igual numa TV de 32", numa de 85" 4K, num tablet ou num
 * celular — não existe mais "tamanho de referência" pra acertar no chute,
 * o próprio navegador informa o tamanho real toda vez.
 *
 * Como isso preserva a relação entre os elementos (texto grande vs. pequeno,
 * ícone vs. avatar, espaçamento entre cards) exatamente como foi desenhada:
 * o conteúdo INTEIRO escala como uma unidade só (mesmo fator nos dois
 * eixos) — nunca elementos individuais cada um adivinhando o próprio
 * tamanho separadamente. É a mesma técnica de redimensionar um pôster ou
 * um SVG: a composição nunca muda de proporção, só de escala.
 *
 * `outer` (o espaço REAL disponível, do tamanho que o layout externo
 * mandar) fica com `overflow-hidden` só como rede de segurança — na
 * prática nunca deveria cortar nada, já que o scale é calculado
 * exatamente pra caber; `items-center justify-center` centraliza o bloco
 * escalado quando sobra espaço numa das direções (ex.: a tela é mais
 * larga, proporcionalmente, que o conteúdo desenhado).
 *
 * `maxScale` (teto explícito, ver abaixo): se o CONTEÚDO ficar raso demais
 * (ex.: pouquíssimos widgets habilitados, sobrando só a logo) e a tela for
 * bem mais alta que o conteúdo precisa, o cálculo puro (`availableH /
 * naturalH`) pode passar de 1 por bastante — sem um teto, um bloco de
 * conteúdo pequeno de mais acaba esticado grande de mais, lendo como
 * "quebrado" mesmo sem cortar nada. Capado antes de aplicar, não durante o
 * cálculo — continua pegando o menor entre largura/altura disponíveis
 * primeiro, só depois limita o resultado final.
 */
export function TvAutoFit({
  children,
  designWidth,
  maxScale = 2,
  className,
  style,
}: {
  children: ReactNode;
  /** Largura (px) em que o conteúdo é desenhado internamente — os valores
   * de fonte/ícone/avatar/espaçamento passados via `style` (custom
   * properties CSS, ver app/tv/tv-view.tsx) foram pensados pra essa
   * largura. Não precisa bater com a tela real — é só a "prancheta" de
   * design; o `scale` calculado abaixo cuida do resto. */
  designWidth: number;
  /** Teto de quanto o conteúdo pode crescer além do tamanho "de design" —
   * ver comentário acima. Default 2x cobre folgado o caso normal (painel
   * cheio, 4 cards) sem deixar um conteúdo raso esticar demais. */
  maxScale?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner || typeof ResizeObserver === "undefined") return;

    // scrollHeight/clientWidth NÃO são afetados por `transform` (transform
    // é só pintura, não participa do cálculo de layout) — então dá pra ler
    // a altura NATURAL (sem escala) do conteúdo mesmo com o scale já
    // aplicado de uma rodada anterior, sem precisar zerar o transform
    // antes de medir.
    const recompute = () => {
      const availableW = outer.clientWidth;
      const availableH = outer.clientHeight;
      const naturalH = inner.scrollHeight;
      if (availableW <= 0 || availableH <= 0 || naturalH <= 0) return;
      const next = Math.min(availableW / designWidth, availableH / naturalH, maxScale);
      if (!Number.isFinite(next) || next <= 0) return;
      setScale((prev) => (Math.abs(prev - next) < 0.002 ? prev : next));
    };

    recompute();
    // Observa os DOIS — `outer` pega mudança de tamanho da TELA/container
    // (resize, TV diferente); `inner` pega mudança de tamanho do PRÓPRIO
    // CONTEÚDO (troca de carrossel, mais/menos aniversariantes, widget
    // ligado/desligado) — qualquer uma das duas dispara um recálculo
    // sozinho, sem precisar de um useEffect ouvindo cada estado que possa
    // influenciar a altura.
    const ro = new ResizeObserver(recompute);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [designWidth, maxScale]);

  return (
    <div ref={outerRef} className={`flex items-center justify-center overflow-hidden ${className ?? ""}`}>
      <div
        ref={innerRef}
        style={{
          width: designWidth,
          transform: `scale(${scale})`,
          ...style,
        }}
      >
        {children}
      </div>
    </div>
  );
}
