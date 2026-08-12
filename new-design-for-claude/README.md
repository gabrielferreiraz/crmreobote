# Handoff: CRM — redesign completo (7 telas)

## Visão geral
Redesenho completo do CRM comercial (funil de consórcio/imóveis): Início, Clientes, Pipeline,
WhatsApp, Agenda, Processos e Relatórios. O objetivo do redesenho foi:

1. Eliminar ruído — o CRM atual mostra o selo "Sem tarefa" em ~100% dos cards, o que anula o sinal.
2. Tornar a **próxima ação** o elemento mais forte de cada card (estado: atrasada / hoje / agendada / inexistente).
3. Dar tratamento honesto a **colunas gigantes** (uma etapa tem 4.699 negócios) via top-N + "Carregar mais".
4. Dar **saúde por etapa** (% de negócios com tarefa) e priorização (ordenar por valor / urgência / tempo parado).
5. Unificar a linguagem visual: superfícies em vidro (glassmorphism) sobre fundo em gradiente, um único
   acento roxo em gradiente, cores funcionais apenas para semântica (atraso, hoje, ok).

## Sobre os arquivos deste pacote
Os arquivos deste bundle são **referências de design feitas em HTML** — protótipos que mostram
aparência e comportamento pretendidos, **não** código de produção para copiar e colar.

A tarefa é **recriar esses designs no ambiente já existente do codebase** (React, Vue, Angular,
Next.js, o que for) usando os padrões, bibliotecas e componentes já estabelecidos ali. Se ainda não
houver ambiente definido, escolha o framework mais adequado ao projeto e implemente lá.

O protótipo usa uma runtime interna de componentes (`.dc.html`): a lógica está numa classe
`Component extends DCLogic` com `renderVals()` devolvendo os valores usados pelo template, e o
template usa `sc-for` / `sc-if` / `{{ path }}`. Isso é **detalhe do protótipo** — traduza para o
padrão do seu app (componentes React + hooks, por exemplo). O que importa é: markup, estilos,
estados, dados e interações descritos abaixo.

## Fidelidade
**Alta fidelidade (hifi).** Cores, tipografia, espaçamentos, raios, sombras e microinterações são
finais. Recreie fielmente, mapeando para os componentes do design system do codebase quando existirem
equivalentes (botão, input, tabela, drawer, modal, tabs).

---

## Design tokens

### Cores — superfície e texto
| Token | Valor | Uso |
|---|---|---|
| `bg/base` | `#EFF0F8` | fundo da página (sob o gradiente) |
| `bg/gradient` | ver abaixo | malha de gradiente fixa no `body` |
| `surface/glass` | `rgba(255,255,255,0.68)` + `backdrop-filter: blur(18px) saturate(140%)` + `border: 1px solid rgba(255,255,255,0.72)` | todos os cards |
| `surface/glass-strong` | `rgba(255,255,255,0.94)`, blur 24px | drawer e modal (sobre scrim) |
| `surface/topbar` | `rgba(255,255,255,0.62)`, blur 18px saturate 150% | barra superior fixa |
| `surface/inset` | `#F2F3F8` | inputs, botões secundários, chips inativos |
| `text/primary` | `#15171F` | títulos e valores |
| `text/secondary` | `#4A4F60` | corpo |
| `text/muted` | `#7B808F` | subtítulos |
| `text/faint` | `#A0A5B5` | labels em caixa alta, metadados |
| `text/disabled` | `#C6CBD9` | dias fora do mês, "sem valor" |
| `divider` | `#EFF0F5` / `#F4F5F9` | bordas de tabela e listas |

Gradiente de fundo (elemento fixo `body::before`, `z-index: 0`, `pointer-events: none`):

```css
background:
  radial-gradient(760px 420px at 12% -6%, rgba(90,91,230,0.20), transparent 62%),
  radial-gradient(620px 380px at 92% 0%,  rgba(14,165,165,0.13), transparent 60%),
  radial-gradient(900px 520px at 70% 108%, rgba(139,92,246,0.14), transparent 62%),
  linear-gradient(180deg, #F7F7FC 0%, #EFF0F8 55%, #EBEDF6 100%);
```

### Cores — marca e semântica
| Token | Valor | Uso |
|---|---|---|
| `accent/solid` | `#5A5BE6` | cor de marca (foco, seleção, links) |
| `accent/gradient` | `linear-gradient(135deg, #7274F0 0%, #4F50D8 55%, #3F40C2 100%)` | botões primários, item de menu ativo, pills ativas, balão enviado |
| `accent/gradient-hero` | `linear-gradient(140deg, #7476F2 0%, #5152DA 50%, #3B3CBE 100%)` | card "valor em aberto", topo do drawer |
| `accent/dark` | `linear-gradient(150deg, #23262F, #15171F 60%, #101219)` | cards escuros ("Exige ação", "Meta do mês") |
| `accent/tint` | `#EFEFFD` | fundo de chip/hover roxo claro |
| `danger` | `#E2564D` / texto `#C0392F` / fundo `#FEEDEB` | tarefa atrasada, parado 21d+, fechado R$ 0 |
| `warning` | `#E0952C` / texto `#9A6410` / fundo `#FFF7E8` | tarefa para hoje, parado 14–20d |
| `success` | `#0F9D6E` / texto `#0F7D5C` / fundo `#E9F7F1` | tarefa agendada, WhatsApp, ganho |
| `neutral-task` | borda `#DFE1EA` tracejada / texto `#98A0B4` / fundo `#F7F8FC` | "sem tarefa" |

Rampa monocromática das etapas do funil (dot + barra), do topo para o fundo do funil:
`#D2D4E6` → `#BDBFEA` → `#A2A4E8` → `#8688E7` → `#6E70E6` → `#4243C7`; etapas extras (Noshow, EXTRAS) `#C6CBD9`.

Sombras: cards `0 1px 3px rgba(20,24,50,0.06–0.08)`; hover de card `0 10px 22px -14px rgba(20,24,50,0.4)` +
`translateY(-1px)`; botão primário `0 6px 14px -8px rgba(79,80,216,0.95)`; drawer `0 24px 60px -18px rgba(21,23,31,0.5)`;
barra de seleção `0 18px 40px -16px rgba(21,23,31,0.8)`.

### Tipografia
Família única: **DM Sans** (Google Fonts, 400/500/600/700), fallback `system-ui, sans-serif`.
Todo número (valor, contagem, hora, data) usa `font-variant-numeric: tabular-nums`.

| Papel | Tamanho / peso / tracking |
|---|---|
| Título de página | 27px / 700 / `-0.035em` |
| Subtítulo de página | 14px / 400 / `#7B808F` |
| Título de card | 16px / 700 / `-0.02em` |
| KPI grande | 28px / 700 / `-0.04em` |
| KPI médio (tiles, relatórios) | 23–26px / 700 / `-0.035em` |
| Label caixa alta | 10.5–11px / 700 / `+0.09em` / uppercase / `#A0A5B5` |
| Nome em card / linha | 13.5px / 700 / `-0.015em` |
| Corpo | 13px / 400–600 |
| Metadado | 11–12px / `#9AA0B0` |
| Chip / pill | 11.5–12.5px / 600–700 |

### Espaçamento, raio, layout
- Container: `max-width: 1560px`, padding `32px 28px 80px` (WhatsApp: `26px 28px 40px`).
- Grid gaps: 12–14px entre cards; 14px entre blocos.
- Raios: página/cards grandes **20px**; cards médios/KPI **16–18px**; botões e inputs **11–13px**;
  chips/pills **20px**; checkbox **6px**; avatar **50%**.
- Alturas de controle: botão/input 38–40px (padding 9–11px vertical).
- Barra superior: 58px, `position: sticky; top: 0; z-index: 30`.

---

## Telas

### 1. Início
**Objetivo:** em 5 segundos o vendedor sabe o tamanho do funil e o que exige ação hoje.

- **Header:** "Boa noite, {nome}" (27/700) + "Funil e pendências · 10 ago 2026". À direita dois botões
  secundários em vidro: "Abrir pipeline", "Minha agenda".
- **Linha de KPIs** — grid 4 colunas, gap 14px, card em vidro (padding 20×22, raio 18):
  label caixa alta, valor 28/700, hint 12px.
  1. NEGÓCIOS ABERTOS · `15.679` · "8 etapas ativas"
  2. PIPELINE ABERTO · `R$ 639,9 mi` · valor por extenso em BRL
  3. FECHADO NO MÊS · `R$ 0,00` em `#C0392F` · "0% da meta de R$ 9,6 mi"
  4. CLIENTES ATIVOS · `73.180` · "4.812 sem negócio aberto"
- **Funil de vendas** (coluna esquerda, `1.55fr`): título + "Valor por etapa" + link "Abrir pipeline →".
  Cada linha é um grid `148px 1fr 132px`: dot da etapa + nome + contagem · barra (altura 9px, raio 6,
  trilho `#F1F2F7`, largura = valor/valorMáximo) · valor compacto alinhado à direita.
  Dados reais: Prospecção 4.699 / R$ 15,9 mi · Mensagem 1.148 / R$ 89,2 mi · Em análise 324 / R$ 118,2 mi ·
  Visita marcada 231 / R$ 46,5 mi · Remarketing 786 / R$ 101,5 mi · Quente 91 / R$ 28,1 mi ·
  Noshow 305 / R$ 24,4 mi · EXTRAS 138 / R$ 42,4 mi.
- **Card "EXIGE AÇÃO"** (escuro, gradiente): três linhas clicáveis, cada uma com número 19/700 branco
  (largura mínima 62px), descrição em `#C4C8D8` e chevron. Clicar **navega para a tela filtrada**:
  `14.412` sem tarefa → Pipeline com filtro "Sem tarefa"; `3.418` parados +30d → filtro "Parados +14d";
  `4` conversas não lidas → tela WhatsApp.
- **Próximas atividades:** título + badge "5 hoje"; itens com pill de hora (roxo para tarefa do CRM,
  verde para WhatsApp, cinza para as demais), título 13/600 e "quem · data" 11.5px; rodapé com botão
  "Ver agenda completa".

### 2. Clientes
- Header: "Clientes" + "73.180 contas na carteira · N exibidas nesta página".
  Ações: Importar, Exportar (secundários) e "+ Novo contato" (primário).
- Busca (300px) + chips de filtro: **Sem e-mail**, **Com negócio aberto**, **Meta Ads**, **Indicação**.
- Tabela em card de vidro, colunas `2.3fr 1.15fr 0.85fr 0.95fr 0.75fr 0.85fr`:
  **Contato** (avatar 30px com iniciais + nome 13.5/600 + e-mail; quando não há e-mail, "sem e-mail" em
  itálico `#C6CBD9`), **WhatsApp** (telefone formatado, tabular), **Origem** (tag neutra `#F2F3F8`/`#5C6272`),
  **Responsável** (avatar 22px + nome), **Negócios** (número), **Em aberto** (valor compacto, 13/700, à direita).
- Linha: padding 13×22, divisória `#F4F5F9`, hover `#FAFAFD`, cursor pointer.
- Rodapé: "Página 1 de 6.098 · 12 por página" + Anterior/Próxima.

### 3. Pipeline
- Header + toggle **Kanban / Lista** + "Importar".
- **Faixa de métricas** — grid `1.3fr 1fr 1fr 1fr`:
  - Card em gradiente roxo: "VALOR EM ABERTO" `R$ 639,9 mi`, % da meta à direita, barra de progresso
    branca sobre `rgba(255,255,255,0.25)`, hint "Fechado no mês vs meta de R$ 9,6 mi · 21 dias úteis restantes".
  - Três tiles clicáveis (filtro on/off, anel de 2px na cor do tile quando ativo):
    **AÇÃO HOJE** (âmbar), **SEM TAREFA** (vermelho), **PARADOS +14D** (violeta).
- **Filtros:** busca + chips (Ação hoje, Sem tarefa, Parados +14d, Sem valor) + ordenação segmentada
  (**Valor**, **Urgência**, **Parado**). "Urgência" ordena por estado da tarefa: atrasada → hoje → agendada → sem tarefa.
- **Colunas** (284px, gap 13px, scroll horizontal). Cabeçalho em card de vidro:
  dot da etapa + nome (12/700, uppercase) + contagem em pill · valor total compacto (15/700) + "média R$ X" ·
  **barra de saúde** = % de negócios com tarefa (verde ≥60%, âmbar ≥30%, vermelho abaixo) · texto "N de M com tarefa · P%".
- **Card de negócio** (vidro, raio 16, padding 13, gap 10):
  1. linha: checkbox (17px, roxo quando marcado) + nome do contato (13.5/700, truncado) + "código · resp." (11px) + avatar 26px;
  2. linha: valor (14/700; quando 0 → "Sem valor" em itálico `#BCC1CE`) + pill de tempo parado
     (cinza <14d, âmbar 14–20d, vermelho ≥21d);
  3. **faixa de tarefa** (o elemento mais importante): borda sólida quando há tarefa, tracejada quando não;
     dot + "texto · prazo" ou "Sem tarefa — agendar". Clique agenda/conclui;
  4. ações: **WhatsApp** (hover verde), **Tarefa**, **Avançar** (move para a próxima etapa).
- Rodapé da coluna: "Carregar mais 4.694" (mostra 4 por coluna por padrão; expande a coluna ao clicar).
- **Drag & drop** entre colunas: `draggable`, `dragover` destaca a coluna (`#E4E4FC` + anel roxo interno de 2px),
  card arrastado a 40% de opacidade; ao soltar, a etapa muda, o "tempo parado" zera e uma entrada é
  adicionada ao histórico.
- **Seleção múltipla:** barra flutuante escura em vidro no rodapé (centralizada, 24px do fundo) com
  "N negócios", "Criar tarefa" em lote e um botão por etapa para mover em lote.
- **Lista:** mesma informação em tabela `40px 1.5fr 0.9fr 1fr 1.5fr 0.7fr 0.6fr` — checkbox, contato,
  valor, etapa, próxima tarefa (colorida pelo estado), responsável, parado.
- **Drawer do negócio** (472px, direita, `slide-in` 190ms `cubic-bezier(0.22,0.7,0.3,1)`):
  topo em gradiente roxo com avatar 44px, nome, valor 25/700, pill de tempo parado e pills de etapa
  (a atual em branco) — clicar move a etapa; bloco "Próxima tarefa" com botão Concluir/Agendar e três
  atalhos ("Ligar hoje 17:00", "WhatsApp amanhã", "Visita esta semana"); dois blocos cinza
  (Responsável, Origem); histórico em timeline (dot colorido por tipo + linha vertical) com campo
  "Registrar contato ou nota…" (Enter salva).
- **Modal "Novo negócio"** (458px, centralizado, fade-up 170ms): Contato, Valor, Responsável, Primeira
  tarefa, pills de Etapa; ao criar, vai para o Pipeline e abre o drawer do novo negócio.

### 4. WhatsApp
- Abas com sublinhado: **Conversas**, Campanhas, Scripts.
- Grid `300px minmax(400px,1fr) 280px`, altura `calc(100vh - 190px)`, `min-width: 1040px`
  (abaixo disso a área rola horizontalmente — **não** comprima as colunas).
- **Lista:** seletor de caixa (WhatsApp CRM · 15 / WhatsApp Geral · 69) em segmented control; busca +
  chip "Não lidas"; itens com avatar 36px, nome (700 quando não lido), prévia truncada, hora e badge
  vermelho de não lidas; item ativo com fundo `#EFEFFD`.
- **Thread:** header (avatar 40 + nome + telefone + "Abrir negócio"); balões — recebidos em vidro branco
  alinhados à esquerda, enviados em gradiente roxo à direita, ambos raio 16 com o canto de origem em 5px,
  hora 10.5px sob o texto; composer com respostas rápidas em pills, input e botão "Enviar" verde
  (`#0F9D6E`), Enter envia.
- **Painel direito:** "Negócio vinculado" (valor 22/700, etapa, responsável) e "Ações rápidas"
  (Agendar tarefa de follow-up, Enviar simulação, Mover para Quente).

### 5. Agenda
- Header + toggle **Mês / Lista** + "+ Nova atividade".
- Grid `1fr 316px`.
- **Calendário:** cabeçalho "Agosto 2026" com ‹ / Hoje / ›; cabeçalho de semana Seg→Dom em caixa alta;
  células de 116px mínimo, dias fora do mês com fundo `#FCFCFE` e número `#C6CBD9`, dia atual com número
  em círculo preto. Até **3 eventos** por célula + "+N mais".
  Estilos de evento (pill 10.5px, raio 7): concluído (cinza, riscado), ligação (azul `#EAF0FF`/`#3B5BDB`),
  WhatsApp (verde `#E6F6EE`/`#0F7D5C`), visita (violeta `#F3F0FD`/`#6D33D6`), atrasado (vermelho `#FEEDEB`/`#C0392F`).
- **Lista:** mesmas atividades em linhas com barra colorida à esquerda, título, quem e horário em pill roxo.
- **Painel "Compromissos agendados"** (próximos 7 dias): barra colorida por tipo + título + contato + horário roxo.

### 6. Processos
- Header + "Configurar categorias" e "+ Adicionar ao processo".
- Três KPIs: PROCESSOS ATIVOS `18`, VALOR TOTAL `R$ 2,9 mi`, COM PENDÊNCIAS `5`.
- Grid `226px 1fr`: árvore de categorias (grupos IMÓVEL / AUTOMÓVEL / SERVIÇOS como labels em caixa alta,
  subcategorias como itens; a ativa em gradiente roxo) + "＋ Nova categoria".
- Kanban de 5 etapas (274px): AG. DOCUMENTOS, COTA E GRUPO CADASTRADOS, CONTEMPLADO, PÓS-CONTEMPLAÇÃO,
  ENTREGUE. Cabeçalho com dot, contagem e total. Card: nome, código do negócio, avatar do responsável,
  tag de status (vermelha quando pendência) e valor. Coluna vazia → "Nenhum processo".

### 7. Relatórios
- Abas segmentadas: **Comercial**, Facebook, Processos. Título "Panorama comercial" + subtítulo;
  três filtros à direita (funis, time, período).
- **Card escuro "META DE AGOSTO DE 2026"**: `R$ 9.600.000,00`, hint "8 consultores × R$ 1,2 mi",
  botão "Usar esta meta".
- Grid 2×2:
  - **Negócios por status:** donut 168px via `conic-gradient` (ganhos verde, perdidos vermelho, aberto `#E9EAF1`),
    furo de 118px com "0% conversão"; legenda com dot, rótulo e percentual.
  - **4 KPIs:** Negócios decididos `31`, Pipeline em aberto, Ticket médio, Total ganho.
  - **Ranking do time:** posição, avatar, nome, valor, barra de progresso relativa ao 1º, "N negócios".
  - **Leads por origem:** grid `150px 1fr 48px` — dot + rótulo, barra (rampa roxa), percentual.

---

## Interações e comportamento
- **Navegação:** a barra superior troca de tela (client-side). Item ativo em gradiente roxo; WhatsApp
  carrega badge de não lidas.
- **Filtros são cruzados:** clicar num item de "Exige ação" (Início) ou num tile do Pipeline aplica o
  filtro correspondente e navega para o Pipeline. Clicar de novo no tile ativo remove o filtro.
- **Estados da tarefa** (regra única usada em card, lista e drawer):
  `atrasada` se o prazo contém "atrasada"; `hoje` se contém "hoje"; `agendada` caso contrário;
  `sem tarefa` quando não há tarefa.
- **Transições:** hover de card 130ms (sombra + `translateY(-1px)`); drawer `cSlide` 190ms
  `cubic-bezier(0.22,0.7,0.3,1)`; modal e barra de seleção `cFade` 150–170ms; realce de coluna no
  drag 130ms.
- **Teclado:** Enter envia a nota no drawer e a mensagem no WhatsApp.
- **Responsivo:** o layout é desktop-first (mínimo confortável ~1280px). Kanban e Processos rolam
  horizontalmente; WhatsApp tem `min-width: 1040px` na área de conversa.

## Estado necessário
| Estado | Tipo | Observação |
|---|---|---|
| `screen` | enum das 7 telas | rota |
| `deals[]` | negócio: id, contato, código, valor, etapa, responsável, diasParado, tarefa, prazo, origem, histórico[] | fonte do Pipeline |
| `view` | `board \| table` | Pipeline |
| `filter` | `null \| Ação hoje \| Sem tarefa \| Parados +14d \| Sem valor` | compartilhado Início↔Pipeline |
| `sort` | `Valor \| Urgência \| Parado` | |
| `pipeQuery`, `clientQuery`, `query` | string | buscas |
| `selected` | set de ids | ações em lote |
| `openId` | id \| null | drawer |
| `dragId`, `dragOver` | id / etapa | drag & drop |
| `expanded` | mapa etapa→bool | "Carregar mais" por coluna |
| `addOpen`, `draft` | bool / form | modal de novo negócio |
| `waBox`, `waConv`, `waDraft`, `waUnreadOnly`, `waTab` | | WhatsApp |
| `agendaView`, `agendaDay` | | Agenda |
| `procCat` | string | categoria ativa |
| `repTab` | string | aba de relatórios |

### Dados / API (o protótipo usa mock — mapear para os endpoints reais)
- Negócios paginados por etapa (o protótipo renderiza os 4 primeiros e expõe "carregar mais N").
- Agregados por etapa: contagem, soma de valor, % com tarefa. **Calcular no backend** — são 15.679 negócios.
- Contatos paginados (12/página) com contagem e soma de negócios.
- Conversas de WhatsApp + mensagens por conversa; envio de mensagem.
- Atividades por intervalo de datas (calendário) e próximas N (Início/Agenda).
- Processos por categoria/etapa; metas e agregados de relatório.

## Formatação (pt-BR)
- Moeda completa: `R$ 639.899.537,00` (`toLocaleString('pt-BR', {minimumFractionDigits: 2})`).
- Moeda compacta (cards e colunas): `R$ 639,9 mi` / `R$ 500 mil` — 1 casa decimal em milhões, sem decimal em milhares.
- Valor zero: exibir "Sem valor" em itálico, nunca `R$ 0,00` nem `—`.
- Contagens: separador de milhar pt-BR (`4.699`).
- Tempo parado: `15d parado`; recém-movido: `agora`.

## Assets
Nenhuma imagem ou ícone externo. Formas geométricas simples (dots, barras, donut) são CSS puro
(`conic-gradient`, `border-radius`). Fonte **DM Sans** via Google Fonts. Se o codebase já tiver um
set de ícones (lucide, phosphor…), use-o nos lugares onde o protótipo usa dots/labels — mantendo o peso visual leve.

## Arquivos deste pacote
| Arquivo | Conteúdo |
|---|---|
| `CRM.dc.html` | **Referência principal** — as 7 telas, com dados e interações reais |
| `Pipeline CRM v2.dc.html` | Iteração anterior só do Pipeline (variante visual azul) |
| `Pipeline CRM.dc.html` | Primeira iteração do Pipeline (fundo claro, sem glass) |
| `support.js` | Runtime do protótipo — **não portar**, é só para abrir os HTML no navegador |

Para ver os protótipos: abra `CRM.dc.html` num navegador (precisa do `support.js` ao lado).
