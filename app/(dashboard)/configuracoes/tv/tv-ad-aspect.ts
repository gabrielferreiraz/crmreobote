/**
 * Proporção (largura/altura) da área de propaganda de verdade na TV (ver
 * tv-view.tsx) — usada pela ferramenta de corte aqui nas configurações
 * (tv-ad-crop-dialog.tsx) e pela miniatura de pré-visualização
 * (tv-config-form.tsx), pra cortar/mostrar a imagem exatamente no formato
 * que ela vai aparecer na tela de verdade, sem precisar adivinhar.
 *
 * RECALCULADA DE NOVO (era 1091/975 ≈ 1.12) — rodada de aumento geral de
 * fonte/ícone/padding (relato ao vivo na TV real, ver globals.css: --tv-gap
 * e --tv-card-py/--tv-icon-lg subiram, o que muda tanto os "vãos" quanto a
 * altura estimada do Churrascômetro usados nesta conta). --tv-panel-w NÃO
 * mudou nesta rodada (continua 40cqw) — a diferença aqui é pequena,
 * puramente da mudança nos outros tokens. Mesma lição de sempre: qualquer
 * mudança em --tv-gap/--tv-card-py/--tv-icon-lg/--tv-panel-w em
 * globals.css exige reconferir esta conta — nada aqui recalcula sozinho, e
 * um valor esquecido aqui é a causa mais provável de propaganda saindo
 * cortada perto da borda (quem corta confia na moldura do diálogo, que
 * promete ser exata).
 *
 * Calculada a partir do layout real de tv-view.tsx numa referência
 * 1920×1080 (16:9, o mesmo da TV de produção — ver
 * lib/tv-display-profile.ts), com os tokens resolvidos pra essa referência
 * (1cqh = 10.8px, 1cqw = 19.2px — ver comentário no topo de app/globals.css
 * sobre o contêiner único de medida):
 *   --tv-gap      = clamp(8px, 1.5cqh, 24px)     ≈ 16.2px
 *   --tv-panel-w  = clamp(450px, 40cqw, 1580px)  ≈ 768px
 *   largura do painel de propaganda
 *     = 1920 - 2*gap(borda da página) - 2*gap(vãos da fileira) - 1px(separador) - painel
 *     ≈ 1920 - 32.4 - 32.4 - 1 - 768 ≈ 1086px
 *   altura do painel de propaganda
 *     = 1080 - 2*gap(borda da página) - gap(vão até o Churrascômetro) - altura do Churrascômetro
 *     (--tv-card-py×2 ≈ 35.6px + --tv-icon-lg ≈ 29.7px ≈ 65px)
 *     ≈ 1080 - 32.4 - 16.2 - 65 ≈ 966px
 *   proporção ≈ 1086 / 966 ≈ 1.12
 *
 * É uma aproximação, não uma garantia matemática (a altura do Churrascômetro
 * em si já é estimada) — TV 4K (3840x2160) tem a mesma proporção de tela
 * (16:9) mas o painel de métricas em px CSS fixo (piso/teto do clamp())
 * ocupa uma fatia proporcionalmente menor, então o painel de propaganda
 * fica um pouco mais largo que isso na prática. Ainda assim, é bem mais
 * preciso que deixar sem corte nenhum — e o object-contain com fundo
 * borrado em tv-view.tsx já cobre a folga quando a proporção real da TV do
 * cliente for um pouco diferente desse valor de referência.
 */
export const TV_AD_ASPECT_RATIO = 1086 / 966;
