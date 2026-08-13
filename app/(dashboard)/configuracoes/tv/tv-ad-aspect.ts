/**
 * Proporção (largura/altura) da área de propaganda de verdade na TV (ver
 * tv-view.tsx) — usada pela ferramenta de corte aqui nas configurações
 * (tv-ad-crop-dialog.tsx) e pela miniatura de pré-visualização
 * (tv-config-form.tsx), pra cortar/mostrar a imagem exatamente no formato
 * que ela vai aparecer na tela de verdade, sem precisar adivinhar.
 *
 * Calculada a partir do layout real de tv-view.tsx numa TV Full HD 1920x1080
 * (o tamanho mais comum de TV/monitor de parede pra esse tipo de painel):
 * container com `p-5` (20px de cada lado) e o painel de métricas com
 * `xl:w-[600px]` (1920px já passa do breakpoint `xl` do Tailwind, 1280px) +
 * `gap-5` (20px) de cada lado do separador de 1px entre os dois painéis.
 *   largura do painel de propaganda = 1920 - 20*2 - 600 - 1 - 20*2 ≈ 1239px
 *   altura                          = 1080 - 20*2                 ≈ 1040px
 *   proporção                       ≈ 1239 / 1040 ≈ 1.19
 *
 * É uma aproximação, não uma garantia matemática — TV 4K (3840x2160) tem a
 * mesma proporção de tela (16:9) mas o painel de métricas em px CSS fixo
 * ocupa uma fatia proporcionalmente menor, então o painel de propaganda fica
 * um pouco mais largo que isso na prática. Ainda assim, é bem mais preciso
 * que deixar sem corte nenhum — e o object-contain com fundo borrado em
 * tv-view.tsx já cobre a folga quando a proporção real da TV do cliente for
 * um pouco diferente desse valor de referência.
 */
export const TV_AD_ASPECT_RATIO = 1239 / 1040;
