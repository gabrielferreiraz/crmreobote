/**
 * Perfil da TV física de produção — a única tela que roda o dashboard
 * (ver app/tv/tv-view.tsx). Confirmado pelo usuário: 85 polegadas,
 * 3840×2160px (4K de verdade, não escalado), ~1900mm × 1090mm de área
 * útil de imagem.
 *
 * Por que isto importa pros tokens fluidos `--tv-*` (app/globals.css):
 * aquele sistema usa `clamp(piso, Nvmin, teto)` pra escalar o layout
 * inteiro só pelo TAMANHO da tela (vmin = 1% da menor dimensão), sem
 * precisar de breakpoint fixo — pensado pra funcionar de uma TV pequena
 * 720p até uma grande 4K. O problema: os TETOS de cada clamp() foram
 * calibrados pra uma referência de 1920×1080 (vmin = 10.8px) e NUNCA
 * reajustados depois que ficou confirmado que a TV real de produção é
 * 3840×2160 — exatamente o DOBRO em cada dimensão, então vmin ali vale
 * 21.6px, o dobro do que os tetos antigos esperavam. Resultado: TODO
 * token fluido batia no teto (pensado pra "no máximo ~1080px de altura")
 * antes de conseguir crescer até o tamanho que a tela de 85" de verdade
 * pedia — o layout inteiro renderizava do tamanho de uma TV Full HD
 * comum, só que fisicamente esticado numa tela 85": texto/ícone/avatar
 * proporcionalmente minúsculos, lendo como "layout de celular" (relato
 * do usuário) mesmo a TV sendo enorme.
 *
 * Os tetos em globals.css foram recalculados a partir de
 * TV_REFERENCE_VMIN_PX/TV_REFERENCE_VW_PX abaixo (coeficiente × referência,
 * arredondado com uma margem pequena) — cada um resolve pro tamanho
 * NATURAL (sem cortar no teto) nesta TV específica. Se a organização
 * trocar de TV algum dia (tamanho/resolução diferente), atualize
 * TV_PRODUCTION_PROFILE aqui e refaça as contas em globals.css — nada
 * recalcula sozinho, mesmo aviso que já existe em tv-ad-aspect.ts.
 */
export const TV_PRODUCTION_PROFILE = {
  widthPx: 3840,
  heightPx: 2160,
  /** Área útil de imagem medida pelo usuário, não o tamanho do gabinete. */
  widthMm: 1900,
  heightMm: 1090,
} as const;

/** vmin = 1% da menor dimensão da tela — numa TV (sempre paisagem), isso
 * já É a altura. min(3840, 2160)/100 = 21.6px. */
export const TV_REFERENCE_VMIN_PX = Math.min(TV_PRODUCTION_PROFILE.widthPx, TV_PRODUCTION_PROFILE.heightPx) / 100;

/** vw = 1% da largura — só usado por --tv-panel-w (única alocação
 * puramente horizontal, ver comentário em globals.css). 3840/100 = 38.4px. */
export const TV_REFERENCE_VW_PX = TV_PRODUCTION_PROFILE.widthPx / 100;

/** Pitch de pixel físico (mm por pixel) — confirma que a tela tem
 * densidade uniforme (~0,5mm/px nos dois eixos, ~51 PPI), coerente com
 * uma 4K genuína de 85" e não um painel "4K" com upscaling estranho.
 * Não é usado em cálculo nenhum hoje, só documenta a medida real por trás
 * da calibração acima, caso precise revisitar essa conta no futuro. */
export const TV_PIXEL_PITCH_MM = {
  x: TV_PRODUCTION_PROFILE.widthMm / TV_PRODUCTION_PROFILE.widthPx,
  y: TV_PRODUCTION_PROFILE.heightMm / TV_PRODUCTION_PROFILE.heightPx,
} as const;
