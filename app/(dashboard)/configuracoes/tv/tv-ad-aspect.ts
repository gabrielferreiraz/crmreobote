/**
 * Proporção (largura/altura) da área de propaganda de verdade na TV (ver
 * tv-view.tsx) — usada pela ferramenta de corte aqui nas configurações
 * (tv-ad-crop-dialog.tsx) e pela miniatura de pré-visualização
 * (tv-config-form.tsx), pra cortar/mostrar a imagem exatamente no formato
 * que ela vai aparecer na tela de verdade, sem precisar adivinhar.
 *
 * RECALCULADA (era 1239/1040 ≈ 1.19) — o valor antigo tinha ficado
 * desatualizado depois do layout de tv-view.tsx trocar pra tokens fluidos
 * (`--tv-gap`/`--tv-panel-w` em clamp(), ver globals.css) no lugar do
 * `p-5`/`xl:w-[600px]` fixo que a conta antiga assumia — a ferramenta
 * prometia "essa é a moldura exata da TV" pra quem cortava a arte, mas a
 * moldura real já tinha mudado de formato. É a causa mais provável de
 * propaganda saindo com parte do conteúdo cortada perto da borda: quem
 * cortou confiando na moldura (então errada) do diálogo.
 *
 * Calculada a partir do layout real de tv-view.tsx numa TV Full HD 1920x1080
 * (o tamanho mais comum de TV/monitor de parede pra esse tipo de painel),
 * com --tv-gap/--tv-panel-w resolvidos pra essa referência
 * (vmin = 10.8px, vw = 19.2px nessa tela):
 *   --tv-gap      = clamp(8px, 1.4vmin, 18px)   ≈ 15.12px
 *   --tv-panel-w  = clamp(320px, 27vw, 600px)   ≈ 518.4px
 *   largura do painel de propaganda
 *     = 1920 - 2*gap(borda da página) - 2*gap(vãos da fileira) - 1px(separador) - painel
 *     ≈ 1920 - 30.24 - 30.24 - 1 - 518.4 ≈ 1340px
 *   altura do painel de propaganda
 *     = 1080 - 2*gap(borda da página) - gap(vão até o Churrascômetro) - altura do Churrascômetro(~60px)
 *     ≈ 1080 - 30.24 - 15.12 - 60 ≈ 975px
 *   proporção ≈ 1340 / 975 ≈ 1.37
 *
 * É uma aproximação, não uma garantia matemática (a altura do Churrascômetro
 * em si já é estimada) — TV 4K (3840x2160) tem a mesma proporção de tela
 * (16:9) mas o painel de métricas em px CSS fixo ocupa uma fatia
 * proporcionalmente menor, então o painel de propaganda fica um pouco mais
 * largo que isso na prática. Ainda assim, é bem mais preciso que deixar sem
 * corte nenhum — e o object-contain com fundo borrado em tv-view.tsx já
 * cobre a folga quando a proporção real da TV do cliente for um pouco
 * diferente desse valor de referência. Se o layout de tv-view.tsx mudar de
 * novo (tokens --tv-*, ou ligar/desligar o Churrascômetro por padrão), essa
 * conta precisa ser refeita — nada aqui recalcula sozinho.
 */
export const TV_AD_ASPECT_RATIO = 1340 / 975;
