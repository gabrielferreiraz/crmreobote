/**
 * Proporção (largura/altura) da área de propaganda de verdade na TV (ver
 * tv-view.tsx) — usada pela ferramenta de corte aqui nas configurações
 * (tv-ad-crop-dialog.tsx) e pela miniatura de pré-visualização
 * (tv-config-form.tsx), pra cortar/mostrar a imagem exatamente no formato
 * que ela vai aparecer na tela de verdade, sem precisar adivinhar.
 *
 * RECALCULADA DE NOVO (era 1274/960 ≈ 1.33) — a rodada anterior tinha
 * aumentado --tv-gap junto com --tv-panel-w; --tv-gap voltou pro valor
 * original (ver globals.css — o aumento de fonte/gap daquela rodada
 * cortava texto nos cards, teve que voltar), só --tv-panel-w continua mais
 * largo. Mesma lição de sempre: qualquer mudança nesses tokens em
 * globals.css exige refazer esta conta — nada aqui recalcula sozinho, e um
 * valor esquecido aqui é a causa mais provável de propaganda saindo
 * cortada perto da borda (quem corta confia na moldura do diálogo, que
 * promete ser exata).
 *
 * Calculada a partir do layout real de tv-view.tsx numa TV Full HD 1920x1080
 * (o tamanho mais comum de TV/monitor de parede pra esse tipo de painel),
 * com --tv-gap/--tv-panel-w resolvidos pra essa referência
 * (vmin = 10.8px, vw = 19.2px nessa tela):
 *   --tv-gap      = clamp(8px, 1.4vmin, 18px)   ≈ 15.12px
 *   --tv-panel-w  = clamp(360px, 30vw, 680px)   ≈ 576px
 *   largura do painel de propaganda
 *     = 1920 - 2*gap(borda da página) - 2*gap(vãos da fileira) - 1px(separador) - painel
 *     ≈ 1920 - 30.24 - 30.24 - 1 - 576 ≈ 1283px
 *   altura do painel de propaganda
 *     = 1080 - 2*gap(borda da página) - gap(vão até o Churrascômetro) - altura do Churrascômetro(~60px)
 *     ≈ 1080 - 30.24 - 15.12 - 60 ≈ 975px
 *   proporção ≈ 1283 / 975 ≈ 1.32
 *
 * É uma aproximação, não uma garantia matemática (a altura do Churrascômetro
 * em si já é estimada) — TV 4K (3840x2160) tem a mesma proporção de tela
 * (16:9) mas o painel de métricas em px CSS fixo ocupa uma fatia
 * proporcionalmente menor, então o painel de propaganda fica um pouco mais
 * largo que isso na prática. Ainda assim, é bem mais preciso que deixar sem
 * corte nenhum — e o object-contain com fundo borrado em tv-view.tsx já
 * cobre a folga quando a proporção real da TV do cliente for um pouco
 * diferente desse valor de referência.
 */
export const TV_AD_ASPECT_RATIO = 1283 / 975;
