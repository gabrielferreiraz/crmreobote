# Memória — Módulo Planilhas (Administrativo)

> Arquivo vivo: atualizar a cada decisão ou descoberta. Idioma: português (UI, logs, domínio); identificadores técnicos em inglês (`Sheet*`, `lib/sheets`, `/api/sheets`).
> Antes de mexer em código de app: ler o aviso do `AGENTS.md` (Next 16 tem breaking changes).
> Não confundir com **Tabelas** (`/tabelas`, `lib/servopa-tables`) — aquilo é o PDF da Servopa (ver `memory-tabelas-servopa.md`).

## Objetivo
Dar ao Administrativo "planilhas próprias" dentro do CRM, para parar de usar Excel/Sheets por fora. Diferente de uma planilha solta, **cada coluna tem tipo** e pode **apontar para um cliente/negócio do CRM** — é isso que permite filtrar, cruzar, montar relatório e integrar.

Por fora: tem que parecer e se comportar como Excel/Sheets (usuários já estão acostumados). Por dentro: banco estruturado.

## Regras de ouro
1. **Somente área ADMINISTRATIVO ou Dono (OWNER).** Vendas — inclusive gerente — não entra (`lib/sheets/access.ts`). Sempre confere no banco, nunca só no JWT.
2. **Uma porta de entrada para valor de célula:** `coerceCellValue` (`lib/sheets/column-types.ts`). Tela, importação e API v1 passam todas por ela. Validação só no navegador se burla.
3. **Nada some sem rastro:** planilha/coluna são *arquivadas*, linha vai para a *lixeira* (`deletedAt`). Toda mudança de célula grava antes→depois em `SheetActivity`. Ações estruturais/massa vão para o `AuditLog`.
4. **Multi-tenant em duas camadas:** `where organizationId` em toda query + RLS (`tenant_isolation`) em todas as 5 tabelas.
5. **SQL só parametrizado.** Filtros/ordenação usam `Prisma.sql` com id de coluna e valor como parâmetro; id de coluna é conferido contra a planilha antes.
6. **Produção "não pode dar erro":** migration só aditiva; nunca `prisma format`; nunca `next build` com o `npm run dev` aberto (usar `tsc --noEmit` + eslint).

## Modelo de dados (migration `20261028150000_sheets`)
- `Sheet` — planilha (nome, descrição, `archivedAt`).
- `SheetColumn` — coluna com `type` (enum `SheetColumnType`), `config` JSON (opções do SELECT, casas decimais), `required`, `position`, `archivedAt`.
- `SheetRow` — `values` JSONB `{ "<columnId>": valor }` (chave = id da coluna → renomear nunca perde dado), `position` float, `deletedAt`. Índice GIN `jsonb_path_ops` para filtro por valor.
- `SheetRowLink` — índice reverso das colunas CONTACT/DEAL ("em quais planilhas este cliente aparece?"). Mantido na mesma transação da escrita. FK com cascade: cliente/negócio apagado leva o vínculo.
- `SheetActivity` — histórico (quem, quando, `source` = `app` ou `api:<apiKeyId>`, `changes` antes→depois).

### Tipos de coluna e armazenamento
TEXT, LONG_TEXT, NUMBER, CURRENCY, PERCENT (guarda 12.5 p/ 12,5%), DATE ("AAAA-MM-DD"), CHECKBOX (bool), SELECT, MULTI_SELECT (string[]), EMAIL (minúsculo), PHONE (normalizado com DDI), CPF/CNPJ (só dígitos, com dígito verificador), URL (só http/https — bloqueia `javascript:`), USER, CONTACT, DEAL (id; existência conferida na organização). Vazio = chave ausente (nunca `null` guardado).

### Limites (`lib/sheets/limits.ts`)
500 planilhas/org · 150 colunas · 50.000 linhas/planilha · texto 1.000 / texto longo 10.000 caracteres · 5.000 linhas por chamada de escrita em lote (com corpo JSON de até 64 MB e fatiamento automático de 1.000 em 1.000 linhas na tela) · importação até 20.000 linhas e 25 MB · página até 500 linhas.

## Código
- `lib/sheets/access.ts` — quem pode.
- `lib/sheets/column-types.ts` — tipos, coerção, config.
- `lib/sheets/sheets.ts` — planilhas e colunas (troca de tipo reconverte valores; incompatíveis → 409 com contagem, `force` apaga só esses).
- `lib/sheets/rows.ts` — inserir/atualizar/lixeira em lote, consulta com filtro/ordenação/busca, resumo agrupado, vínculos, histórico.
- `lib/sheets/io.ts` — importar (planilha nova com tipos detectados, ou anexar casando cabeçalho; casa cliente por id/telefone/e-mail só se achar exatamente 1) e exportar `.xlsx` (com proteção contra fórmula maliciosa).
- `lib/sheets/http.ts` — schemas zod + webhooks; `lib/sheets/v1.ts` — base da API pública.
- Testes sem banco: `node --experimental-transform-types --import ./scripts/alias-loader.mjs --test scripts/test-sheets.ts` (11 testes).

## API
**Interna (sessão do Administrativo)** — `/api/sheets`:
`GET/POST /` · `GET/PATCH /[id]` (`archived`) · `POST /[id]/columns` · `PATCH /[id]/columns/[columnId]` · `POST/PATCH/DELETE /[id]/rows` · `POST /[id]/rows/query` · `POST /[id]/rows/restore` · `POST /[id]/summary` · `GET /[id]/history` · `GET /[id]/export` · `POST /import` (`mode`: preview|new|append) · `GET /linked?contactId=|dealId=`.

**Pública (API key)** — `/api/v1/sheets`: `GET /` · `GET /[id]` · `GET/POST/PATCH/DELETE /[id]/rows` · `POST /[id]/rows/query` · `POST /[id]/summary` · `GET /linked`. Documentada em `docs/integracoes-api.md`.

**Webhooks:** `sheet.row.created`, `sheet.row.updated`, `sheet.row.deleted` (acima de 200 linhas num lote vira 1 evento-resumo com os ids).

**Filtros:** `eq, neq, contains, notContains, gt, gte, lt, lte, empty, notEmpty, in`; `match: all|any`. **Resumo:** `count, countFilled, sum, avg, min, max` com `groupBy` opcional (MULTI_SELECT conta em cada opção).

## Estudo de projetos open source (ideias, não código)
Referências do mesmo tipo de produto: **NocoDB**, **Baserow**, **Teable** (planilha sobre banco). Nada foi copiado; foi aproveitado o *desenho*:
- **Coluna com id estável e valores por id** (não por nome) — renomear coluna é só metadado. Todos fazem algo assim.
- **Tipos "ricos" com validação no servidor** e conversão ao trocar tipo — Baserow reconverte e avisa o que se perde; aqui: 409 com contagem + `force`.
- **Campo de vínculo com índice reverso** (link/lookup) — aqui `SheetRowLink`, limitado a cliente/negócio do CRM (o valor do módulo é cruzar com o CRM, não ligar planilha com planilha — fica para depois).
- **Lixeira e histórico por linha** — Baserow/Teable têm "row history"; aqui `SheetActivity`.
- **Diferença deliberada:** Baserow/NocoDB criam uma tabela física por planilha (DDL em produção). Aqui é **JSONB numa tabela só** — sem `ALTER TABLE` em produção a cada coluna nova, RLS já pronta, e o volume previsto (dezenas de milhares de linhas) cabe bem com índice GIN.

## Estado atual (2026-10-28)
- **Migration `20261028150000_sheets` APLICADA EM PRODUÇÃO** (autorizado pelo usuário: "testar no banco em produção, mas não pode dar errado"). Aplicada numa única transação (falha = nada muda) e registrada com `prisma migrate resolve --applied`. As 5 tabelas estão com RLS forçada e as permissões do `app_runtime` vêm automaticamente (default privileges do `postgres`).
- **Teste de ponta a ponta em produção: 14/14 OK** (`scripts/test-sheets-prod.ts`): cria uma planilha "[TESTE]", exercita tudo (inclusive isolamento entre organizações por SQL cru) e apaga a planilha no fim. As tabelas ficaram com 0 linhas depois. Pode ser rodado de novo com segurança.
- Checagem somente leitura do banco: `node scripts/sheets-prod-check.mjs`.
- Código **sem commit e sem deploy** (o CRM em produção ainda não tem as rotas nem a tela).
- ⚠️ Produção tem 4 migrations que não estão nesta cópia local (`20261023180000_process_deal_optional`, `20261026120000_process_contact_optional`, `20261026160000_process_value`, `20261027140000_proposal_cover_before_copy`) — foram feitas em outra máquina/branch. Sincronizar o código antes do próximo deploy.

## Simplicidade (pedido do usuário)
"Para integrações internas não precisa de API — o mais simples possível." Dentro do CRM, outras telas e módulos chamam **direto** as funções de `lib/sheets` (ex.: ficha do cliente → `linkedRows`), sem HTTP. A API v1 + webhooks existem só para sistemas de FORA (Make/n8n/BI) e são opcionais: dá para remover `app/api/v1/sheets` e os eventos `sheet.row.*` sem afetar nada mais.

## Design / frontend (escrito em 2026-10-28 — aguardando teste do usuário)
**Princípio:** por fora igual ao Excel/Sheets (o pessoal já está acostumado); por dentro, colunas tipadas.

- **Menu "Planilhas"** (ícone FileSpreadsheet) no topo e na folha "Mais" do celular, só com `showSheets` = Administrativo ou Dono (`app/(dashboard)/layout.tsx`). Página e rotas conferem de novo (quem não pode é mandado para `/`).
- **`/planilhas`** (`sheets-home.tsx`): cartões com nº de linhas e "editado há…", busca, abas Ativas/Arquivadas (restaurar), "Nova planilha" e "Importar Excel/CSV".
- **Importação** (`import-dialog.tsx`): arrastar arquivo → prévia com os tipos detectados (planilha nova) ou mapeamento coluna↔cabeçalho pré-preenchido pelo nome (anexar) → resultado com linhas recusadas e o motivo.
- **`/planilhas/[id]`** (`sheet-editor.tsx` + `sheet-grid.tsx`):
  - Grade virtualizada (só desenha as linhas visíveis; carrega de 200 em 200 ao rolar). Cabeçalho e nº da linha fixos.
  - Teclado do Excel: setas, Shift+setas, Ctrl+setas, Tab/Shift+Tab, Enter/F2 editam, digitar já começa a editar substituindo, Esc cancela, Delete limpa, Ctrl+A, Home/End, PageUp/PageDown, Ctrl+Z / Ctrl+Y (também Ctrl+Shift+Z), espaço marca checkbox.
  - **Copiar/colar com o Excel/Sheets** (TSV; vírgula decimal; aspas para célula com quebra de linha). Colar além do fim cria linhas. Um valor colado sobre uma seleção maior preenche a seleção toda.
  - Alça de preenchimento (quadradinho no canto): repete o bloco; números em sequência continuam a sequência (1,2 → 3,4…).
  - Linha "+" no fim: digitar nela cria a linha.
  - Barra de status como a do Excel: contagem, soma e média da seleção.
  - Editores por tipo: texto/número/data (DD/MM/AAAA) no lugar; texto longo em caixa maior; seleção com busca e **criar opção na hora**; múltipla com marcação; Cliente/Negócio/Membro com busca (`/api/sheets/lookup`). Cliente/Negócio aparecem como etiqueta com link para a ficha.
  - Menu da coluna: editar (nome, tipo, opções arrastáveis, casas decimais, obrigatória), ordenar, filtrar, inserir à esquerda/direita, arquivar (restaurar em ⋯ → Colunas arquivadas). Largura arrastável (duplo clique volta ao padrão), guardada no navegador.
  - Clique direito: copiar, colar, limpar, abrir cliente/negócio, histórico da linha, excluir linhas (lixeira; Ctrl+Z desfaz).
  - Barra: renomear clicando no título, indicador Salvando…/Salvo, busca, filtros com várias condições (todas/qualquer), ordem ativa com X para remover, desfazer/refazer, ⋯ (importar linhas, baixar Excel, histórico, lixeira, colunas arquivadas, arquivar planilha).
  - Gravação: validação instantânea no navegador (mesma `coerceCellValue` do servidor), otimista (mostra na hora e volta atrás se o servidor recusar, com aviso), em fila (nunca duas escritas competindo). Desfazer/refazer vale para células, linhas novas e exclusões (até 100 passos, só na sessão).
- Histórico (`history-panel.tsx`): painel lateral com quem mudou, quando, e valor antes → depois.
- Lint e `tsc` limpos; 15 testes unitários (inclui colar do Excel e formatação). Rotas conferidas no `npm run dev` do usuário (403 sem login). **A tela em si ainda não foi aberta logada — o usuário vai testar.**
- Fora do escopo desta fase: fórmulas, painel na ficha do cliente, visões salvas, gráficos, congelar colunas, colar nome de cliente que ainda não apareceu na tela (por ora pede o seletor).

## Redesenho "cara de Excel" (2026-10-28, 2ª rodada — pedido: "totalmente mais parecido com o Excel e intuitivo")
Feedback do usuário no 1º teste: funcionou, mas a planilha vazia parecia uma tabela solta (uma coluna, muito branco). Mudanças:
- **Tela inteira:** `/planilhas/[id]` virou app shell sem teto de largura (`app/(dashboard)/app-main.tsx`, `isSheetEditor`), moldura justa; o editor é um "documento" com borda arredondada ocupando 100% da altura.
- **Estrutura igual ao Excel**, de cima para baixo:
  1. Título: ícone verde de planilha, nome (clique renomeia), Salvando…/Salvo, Localizar (Ctrl+F), ⋯ (colunas arquivadas, atalhos, arquivar).
  2. **Faixa de ferramentas** em grupos separados por divisórias: Desfazer/Refazer · + Linha / + Coluna · Classificar A→Z / Z→A (na coluna da célula ativa) / Filtro · Importar / Exportar · Histórico / Lixeira · Atalhos. Etiqueta "Ordem/filtros ✕" limpa tudo.
  3. **Barra de fórmulas:** caixa de nome (mostra A1 ou B2:D9; digitar "B12"+Enter vai até lá), `fx`, conteúdo editável da célula (✓/✕ aparecem ao editar), tipo da coluna à direita. Tipos com seletor abrem o editor da célula.
  4. **Grade:** cabeçalho em 2 andares — **letras A, B, C…** + nome do campo com ícone do tipo; canto "selecionar tudo"; números de linha; **linhas e colunas vazias preenchem a tela** (qualquer linha vazia aceita digitação e vira linha nova; cabeçalho das colunas vazias = "+ Coluna"). Linhas de grade cinza estilo Excel (variáveis CSS `.sheet-grid-theme` em `globals.css`, com tema escuro). Seleção: área clara, **célula ativa branca**, borda grossa da cor da marca, alça de preenchimento quadrada; cabeçalho de linha/coluna selecionado destacado com traço da marca. Número/data alinhados à direita, texto à esquerda (como o Excel).
  5. **Rodapé:** **abas das planilhas** (como as abas do Excel; aba ativa com traço; "+" cria "Planilha N" e abre) + barra de status (Média · Contagem · Soma da seleção, total de linhas).
- **Novidades de interação:** duplo clique no nome da coluna renomeia ali mesmo; duplo clique na borda da coluna **ajusta a largura ao conteúdo** (mede o texto de verdade); clique direito no cabeçalho abre o menu da coluna; clique direito no nº da linha seleciona a linha; Ctrl+D (preencher para baixo); Shift+Espaço / Ctrl+Espaço (linha/coluna); Ctrl+setas pula até a borda dos dados (igual ao Excel); link (URL) abre com Ctrl+clique; menu de contexto com Recortar/Copiar/Colar/Preencher para baixo/Limpar conteúdo; **painel de atalhos** (botão ou "?").
- **Planilha vazia:** cartão de boas-vindas dentro da grade ("clique e digite", "cole do Excel com Ctrl+V", botões Importar / + Coluna).
- Correções da revisão: painel de filtros agora é fixo na tela (a faixa rola na horizontal e o cortava); barra de fórmulas não fica com valor velho após editar na célula; seleção não sai da área desenhada ao descer com as setas (grade estica, teto de +500 linhas vazias); Enter + perda de foco do editor não salvam duas vezes.
- `tsc` + eslint limpos; 15 testes unitários passando. **Aguardando novo teste visual do usuário.**

## 3ª rodada — "muito parecido com o Excel" + linhas de grade, marcações, tabelas do Excel, filtros (2026-10-28)
Pedido: "é para ser muito parecido com excel… que já venha com as linhas de grade, as marcações, fazer tabelas do excel, filtros… engenharia reversa pra destrinchar mesmo".

**Engenharia reversa (de comportamento, sem copiar código):** cores do tema "Office" e regra de tons da paleta (clarear 80/60/40, escurecer 25/50) e os presets de tabela TableStyleLight/Medium/Dark 1–7 seguem o padrão aberto do .xlsx (ECMA-376 / Office Open XML). O nome do preset vai na exportação → o arquivo abre no Excel como TABELA de verdade. Comportamentos imitados: linha 1 = cabeçalho com AutoFiltro, Enter só desce (F2 edita), Backspace limpa e edita, Ctrl+setas pula até a borda dos dados, digitar à direita da tabela cria coluna (expansão da tabela), Linha de Totais com SUBTOTAL, "formigas marchando" ao copiar, Caixa de Nome, barra de status "Pronto/Editar/Inserir/Modo de Filtro".

**Banco (migration `20261028180000_sheets_formats`, aditiva):** `Sheet.settings` (JSON: `table` = estilo, cabeçalho, faixas, primeira coluna, totais, função por coluna) e `SheetRow.formats` (JSON por célula: b, i, u, s, fill, color, align). Validados em `lib/sheets/formats.ts` (cor só `#RRGGBB`, chaves desconhecidas recusadas). ⚠️ **AINDA NÃO APLICADA EM PRODUÇÃO** — a execução foi bloqueada pela proteção de permissões do Claude Code; o usuário precisa autorizar/rodar: `node scripts/sheets-prod-apply.mjs 20261028180000_sheets_formats` e `npx prisma migrate resolve --applied 20261028180000_sheets_formats`. Até lá a tela das planilhas dá erro (o código já lê essas colunas).

**Tela (`app/(dashboard)/planilhas/[id]/`):**
- Verde do Excel (#107C41) só dentro da planilha (`.xl-theme` em `globals.css`, com tema escuro); fonte Aptos/Calibri; linha 21px; linhas de grade cinza **ligadas por padrão**.
- Barra de título verde (nome, "Salvo" com nuvem, Localizar).
- **Faixa de Opções** (`ribbon.tsx`): Arquivo (painel Backstage: Novo, Abrir, Renomear, Importar, Baixar uma Cópia, Histórico, Arquivar) · Página Inicial (Desfazer · Área de Transferência · **Fonte**: N/I/S/tachado, Cor de Preenchimento e Cor da Fonte com paleta do Excel · **Alinhamento** · **Número**: caixa de formato = tipo da coluna, R$, %, 000, aumentar/diminuir casas · **Estilos**: Formatar como Tabela (galeria Claro/Médio/Escuro) · Células: Inserir/Excluir/Formatar · Edição: Classificar e Filtrar, Localizar, Limpar Tudo/Formatos/Conteúdo) · Inserir (Tabela, Nova Linha, galeria de tipos de coluna) · Dados (Do Arquivo, Baixar .xlsx, A→Z/Z→A, Filtro, Limpar, Avançado, Histórico, Lixeira, Colunas Arquivadas) · Exibir (Barra de Fórmulas, Linhas de Grade, Títulos, Zoom) · guia contextual **Design da Tabela** (Linha de Cabeçalho/Totais, Linhas em Tiras, Primeira Coluna, Botão de Filtro, estilos, Converter em Intervalo). Recolher com ˄.
- Barra de fórmulas: Caixa de Nome, ⋮ ✕ ✓ fx; na linha 1 mostra/renomeia a coluna; em coluna nova cria a coluna.
- Grade (`sheet-grid.tsx`): **linha 1 = nomes das colunas** (congelada, negrito, com botão ▾ do **AutoFiltro**); dados a partir da linha 2; colunas/linhas vazias até o fim da tela; digitar à direita cria coluna "ColunaN" (ou com o nome digitado na linha 1); colar um bloco do Excel com cabeçalho em A1 cria/renomeia colunas. Estilo de tabela (cabeçalho colorido, faixas, primeira coluna), marcações por cima do estilo, seleção como véu cinza por cima do preenchimento. **Linha de Totais** logo abaixo dos dados com seta para escolher Nenhum/Média/Contagem/Contar Números/Máx/Mín/Soma (calculada no banco, respeitando filtros). Zoom 50–200% (tudo escala). Atalhos: Ctrl+B/I/U(ou S)/5, Ctrl+L (tabela), Ctrl+Shift+L (botões de filtro), Ctrl+D, Ctrl+F.
- **AutoFiltro** (`autofilter-menu.tsx`): Classificar, Limpar Filtro, Filtros de Texto/Número/Data, Pesquisar, lista de valores com contagem, (Selecionar Tudo), (Vazias), OK/Cancelar. Backend: filtro `in` aceita `null` = vazias e casa MULTI_SELECT por conteúdo; `/summary` devolve nomes de cliente/negócio.
- Rodapé: abas das planilhas com setas e (+); barra de status com Pronto/Editar/Inserir/Modo de Filtro, "N registros encontrados", Média/Contagem/Soma e zoom com controle deslizante.
- Lixeira: faixa amarela como o "Modo de Exibição Protegido".
- Exportação: vira tabela do Excel (preset, filtros, totais) + marcações + formatos de número; sem tabela, AutoFiltro no cabeçalho.
- Verificação: `tsc` e eslint limpos; 19 testes unitários (inclui paleta/estilos/validação de marcação). `scripts/test-sheets-prod.ts` ganhou passos para marcações, (Vazias) e tabela — rodar depois de aplicar a migration.

## 4ª rodada — Fórmulas + colar/copiar com estilo do Excel (2026-10-28)
Pedido: "pelas fórmulas, quero que teste tudo" + "deve copiar o estilo… como estiver no Excel original, ctrl c / ctrl v". Usuário quer o máximo de fidelidade ao Excel (equipe sem medo de trocar).

**Motor (`lib/sheets/formula.ts`, puro, roda na tela e na exportação):** sintaxe do Excel PT-BR (`;` separa, vírgula decimal, nomes PT ou EN, com/sem acento), A1/$A$1/B2:C10/C:C, operadores e precedência do Excel (=-2^2 → 4), erros #DIV/0! #VALOR! #REF! #NOME? #N/D #NÚM!, ~70 funções (SOMA, MÉDIA, SE, SES, E/OU, SEERRO, SOMASE(S), CONT.SE(S), MÉDIASE, PROCV/PROCH/PROCX, ÍNDICE/CORRESP, ARRED…, texto, TEXTO com formatos, datas como número de série do Excel, DATADIF, DIATRABALHOTOTAL, FIMMÊS, DATAM, SUBTOTAL…), referência circular (mostra 0 + aviso na barra de status, como o Excel).
- **Guardado como o R1C1 do Excel:** coluna pelo ID (mover/renomear/inserir coluna não quebra; excluir → #REF!) e linha RELATIVA (`~-1`) ou absoluta (`$5`). Arrastar fórmula = copiar o texto interno (referências andam sozinhas). Linhas = ordem real (posição), não a visão filtrada.
- Resultado é gravado em `values` (filtro/soma/totais/exportação usam); o que não cabe no tipo (texto em Moeda, erro) é mostrado mas guardado vazio. Percentual: 12,5% vale 0,125 na fórmula (igual ao Excel). Fórmula não é aceita em Seleção/Seleção múltipla/Cliente/Negócio/Membro.
- Cálculo no navegador sobre a planilha inteira (carrega todas as linhas quando há fórmula; teto 20 mil); a cada mudança recalcula e grava só o que mudou.

**Banco:** `SheetRow.formulas` (JSON) na migration `20261028200000_sheets_formulas` (separada: a `20261028180000_sheets_formats` já tinha sido aplicada pelo usuário só com settings/formats — nunca editar migration já aplicada). Consulta devolve `rank` (posição real = número da linha do Excel − 1), `allTotal`, `hasFormulas`. Inserir linhas aceita `extras` (marcações/fórmulas). Histórico registra `ROW_FORMULA`.

**Tela:** digitar `=` abre editor de fórmula em qualquer tipo; **autocompletar de funções** (Tab insere `NOME(`), **dica amarela de sintaxe** com o argumento atual em negrito, **modo apontar** (clicar na célula insere a referência; Shift+clique = intervalo), fecha parênteses esquecidos ao confirmar; F2/duplo clique abre com a fórmula; barra de fórmulas mostra a fórmula; números de linha = posição real (azuis quando filtrado, como no Excel); Caixa de Nome usa esses números. Guia **Fórmulas** (Inserir Função com busca, AutoSoma Σ com Soma/Média/Contar/Máx/Mín, Mostrar Fórmulas) + AutoSoma em Página Inicial › Edição. Atalhos Alt+= e Ctrl+`.

**Copiar/colar com estilo (`lib/sheets/clipboard-html.ts`):** engenharia reversa do HTML que o Excel/Google Sheets põem na área de transferência (`<style>` com classes .xl65, estilo inline, `<b>/<i>/<u>/<s>/<font>`, colspan) → texto + marcações (negrito, itálico, sublinhado, tachado, cor, preenchimento, alinhamento). Copiar daqui grava texto + HTML com estilo inline (o Excel recebe a formatação). Cópia interna (sessionStorage) leva fórmulas e marcações entre planilhas. Arrastar a alça também copia marcação e fórmula. Exportação .xlsx leva a fórmula viva (inglês, vírgula) com o resultado.

**Testes:** 31 unitários (inclui 12 grupos/150+ verificações do motor de fórmulas) + 5 de copiar/colar com HTML real de Excel e Google Sheets (jsdom fora do projeto: `JSDOM_PATH=… node --experimental-transform-types --import ./scripts/alias-loader.mjs --test scripts/test-sheets-clipboard.ts`). `tsc`/eslint limpos. `scripts/test-sheets-prod.ts` cobre marcações, tabela, (Vazias), fórmulas, linha nova com extras e exportação com fórmula — migrations `…180000_sheets_formats` e `…200000_sheets_formulas` aplicadas pelo usuário; **19/19 passos OK em produção** (28/10).

## Próximos passos
1. ~~Migration + teste em produção~~ (feito em 2026-10-28). Falta: commit + deploy.
2. Design/tela (fase separada, pedido do usuário): grade estilo Excel (setas, Enter/Tab, Ctrl+C/Ctrl+V do Excel, arrastar para preencher, Ctrl+Z), menu "Planilhas" só para Administrativo/Dono, painel "Planilhas" na ficha do cliente (`/api/sheets/linked`).
3. Depois: fórmulas básicas (SOMA, MÉDIA, SE, PROCV), visões salvas (filtros por planilha), gráficos sobre `/summary`, gatilho de automação em mudança de linha, vínculo planilha↔planilha.

## 5ª rodada — Atalhos adicionais do Excel (2026-10-28)
**Como o Excel faz:** `Ctrl+;` insere a data atual e `Ctrl+Shift+;` insere a hora atual no formato regional; `Ctrl+'` copia a fórmula da célula imediatamente acima. `Ctrl+Shift+seta` mantém a âncora e estende a seleção até a borda do bloco de dados. Durante a edição de fórmula, `F4` alterna a referência sob o cursor em `A1 → $A$1 → A$1 → $A1 → A1`; `Ctrl+Enter` confirma a mesma entrada em todas as células selecionadas, mantendo a seleção.

Implementado na grade/editor: data e hora passam pelo mesmo `CellChange`/`coerceCellValue`; a fórmula de cima é recompilada na linha de destino; `Ctrl+Enter` envia o bloco inteiro numa gravação e num passo do Ctrl+Z. A edição conserva a seleção múltipla, e o F4 ignora referências aparentes dentro de texto entre aspas. Verificação: 31 testes gerais/fórmulas + 5 de área de transferência passaram; TypeScript e ESLint sem erros.

## 6ª rodada — Novas funções do Excel (2026-10-28)
**Como o Excel faz:** `SOMARPRODUTO` exige matrizes com a mesma dimensão e trata entradas não numéricas como zero; `MÁXIMOSES`, `MÍNIMOSES` e `MÉDIASES` exigem intervalos de mesmo tamanho e aplicam todos os critérios. `ESCOLHER` usa índice iniciado em 1 e `CORRESPX` oferece correspondência exata/aproximada/coringa e busca para frente ou para trás. `ÉPAR`/`ÉIMPAR`, `ARREDMULTB` e `TRUNCAR` seguem truncamento/sinal do Excel; `NÚM.SEMANA` respeita o tipo de semana e `DIATRABALHO` exclui sábados, domingos e feriados. `REPT` limita o resultado a 32.767 caracteres; `TIRAR`, `CARACT` e `CÓDIGO` seguem a tabela de caracteres do Excel, e `NÃO.DISP()` produz `#N/D` para uso com `SENÃODISP`.

Implementadas no catálogo/autocompletar, no avaliador PT-BR e na tradução para nomes ingleses do `.xlsx`: SOMARPRODUTO, MÁXIMOSES, MÍNIMOSES, MÉDIASES, ESCOLHER, CORRESPX, ÉPAR, ÉIMPAR, ARREDMULTB, TRUNCAR, NÚM.SEMANA (com alias NÚMSEMANA), DIATRABALHO, REPT, TIRAR, CARACT, CÓDIGO e NÃO.DISP; ÉCÉL.VAZIA foi preservada. Os testes cobrem dimensões, critérios vazios, modos do CORRESPX, ANSI/Windows-1252, limite de REPT, semana ISO, feriados e erros. Verificação: 32 testes gerais/fórmulas + 5 de área de transferência passaram; TypeScript e ESLint sem erros.

## 7ª rodada — Pincel de Formatação (2026-10-28)
**Como o Excel faz:** o botão fica em Página Inicial › Área de Transferência e copia somente a formatação da célula ativa, nunca o valor nem a fórmula. Um clique mantém o pincel ligado para uma única seleção de destino; um duplo clique o mantém ligado para várias seleções. Cada destino substitui suas marcações pelas da origem e pode ser desfeito; `Esc` cancela o modo persistente sem alterar mais células.

Implementado com snapshot validado por `cleanFormat`: a grade só aplica depois que o clique/arraste de seleção termina, evitando uma gravação por célula durante o arraste. Cada destino gera `FmtEdit` pelo mesmo `patchRows`, entra como um passo no Ctrl+Z e o modo persistente fica visível no botão/cursor até Esc. Verificação: 32 testes gerais/fórmulas + 5 de área de transferência passaram; TypeScript e ESLint sem erros.

## 8ª rodada — Localizar e Substituir (2026-10-28)
**Como o Excel faz:** `Ctrl+F` abre a guia Localizar e `Ctrl+H` abre Substituir no mesmo diálogo; Página Inicial › Edição usa o menu “Localizar e Selecionar”. “Localizar Próxima” percorre as células e “Localizar Tudo” mostra uma lista clicável com endereço e conteúdo. “Diferenciar maiúsculas de minúsculas” muda a comparação e “Coincidir conteúdo da célula inteira” impede correspondências parciais. “Substituir” altera a ocorrência atual e avança; “Substituir Tudo” altera todas, mantendo valores/fórmulas válidos e permitindo desfazer o lote.

Implementado em diálogo próprio, sem confundir com a pesquisa do cabeçalho que filtra linhas. Ao abrir, carrega a planilha inteira em páginas (até o limite de 50 mil), procura em valores e fórmulas, navega por endereço e revela uma linha escondida pela paginação/filtro quando necessário. Substituições usam `coerceCellValue` ou `compileFormula`, atualizam referências pelo nome e passam por um único `patchRows`/Ctrl+Z. Verificação: 32 testes gerais/fórmulas + 5 de área de transferência passaram; TypeScript e ESLint sem erros.

## 9ª rodada — Colar Especial (2026-10-28)
**Como o Excel faz:** `Ctrl+Alt+V` e Página Inicial › Área de Transferência › Colar abrem “Colar Especial”. “Tudo” leva conteúdo, fórmulas e formatos; “Valores” leva apenas os resultados/constantes; “Fórmulas” leva fórmulas e constantes sem formatos; “Formatos” não altera conteúdo; “Transpor” troca linhas por colunas levando tudo. A operação começa na célula ativa, preserva a seleção resultante e entra como um único passo de desfazer.

Implementado sobre `sessionStorage` (`sheets-internal-clip`) com validação defensiva do conteúdo. A grade separa `raw`, `formula` e `format` por modalidade; Transpor gira as duas matrizes juntas e o diálogo só abre quando existe uma cópia interna. O menu Colar e o atalho abrem as mesmas cinco opções, todas pelo fluxo normal de `CellChange`/Ctrl+Z. Verificação: 32 testes gerais/fórmulas + 5 de área de transferência passaram; TypeScript e ESLint sem erros.

## 10ª rodada — Bordas (2026-10-28)
**Como o Excel faz:** Página Inicial › Fonte › Bordas oferece “Borda Inferior”, “Borda Superior”, “Borda Esquerda”, “Borda Direita”, “Sem Borda”, “Todas as Bordas”, “Bordas Externas” e “Borda Inferior Espessa”. As bordas direcionais atingem a extremidade correspondente da seleção; Todas cria também as divisões internas; Sem Borda remove os quatro lados. A marcação pertence à célula, é copiada/colada, entra no Ctrl+Z e vira borda real no `.xlsx`; ao colar HTML do Excel, `border-top/right/bottom/left` e o atalho `border` são respeitados.

Implementado sem migration: `cellFormatSchema` ganhou quatro lados estritos com estilos/cores compatíveis com ExcelJS; `cleanFormat` e `formatCss` desenham a marcação na grade. O menu aplica extremidades, divisões internas, remoção e inferior espessa por `FmtEdit`; clipboard lê/escreve shorthand e lados CSS (inclusive fino/médio/espesso, tracejado, pontilhado e duplo); exportação gera `cell.border` real no `.xlsx`. Verificação: 32 testes gerais/fórmulas + 6 de área de transferência passaram; TypeScript e ESLint sem erros.

## 11ª rodada — Integração manual com o CRM (2026-10-28)
Pedido: começar sob demanda, puxando e enviando informações entre Planilhas e qualquer parte do CRM; a experiência automática/intuitiva fica para uma fase posterior.

**Decisão de produto e segurança:** a primeira entrega usa uma lista branca expansível de conectores, iniciando por **Clientes** e **Negócios**. Não existe acesso genérico a modelo/tabela do Prisma. A leitura é somente do tenant autenticado e a escrita volta pelas APIs de domínio já existentes (`PUT /api/contacts/[id]` e `PUT /api/deals/[id]`), preservando permissões, validações, auditoria/undo, webhooks e efeitos como comissão/processo. A coluna tipada `CONTACT`/`DEAL` é a identidade estável da linha e prepara uma sincronização futura sem depender de nome ou telefone.

**Fluxo sob demanda:** Dados ganha “Obter Dados do CRM” e “Enviar ao CRM”. Obter permite escolher a origem, pesquisar, selecionar campos, mapear cada campo para uma coluna compatível ou criar uma nova, revisar uma prévia e confirmar a adição das linhas. Enviar exige uma coluna de vínculo, mapeia colunas para campos graváveis, mostra a prévia e pede confirmação. Por segurança, células vazias não apagam dados nesta versão e cada envio tem limite explícito; falhas ficam detalhadas por registro. Sem migration.

**AutoAjuste de linha (pedido adicional):** duplo clique na divisória inferior do número da linha calcula a altura necessária pelo maior conteúdo quebrado entre as células, preservando o duplo clique dentro da célula para edição. A grade passou a aceitar alturas variáveis na virtualização, rolagem, seleção, editor e alça de preenchimento; a preferência fica salva localmente por planilha e pelo id real da linha, acompanhando filtros e ordenação.

**Correção do AutoAjuste de coluna (2026-10-29):** a divisória de AutoAjuste existia somente na faixa das letras quando os títulos estavam visíveis, e o primeiro clique podia iniciar a camada de redimensionamento antes do `dblclick`. A área ativa agora aparece tanto entre as letras quanto na borda direita do cabeçalho com o nome, foi ampliada para 8px e reconhece o segundo `mousedown` antes do modo de arraste. Duplo clique em qualquer uma dessas divisórias ajusta a largura ao conteúdo; dentro da célula continua editando.

**Verificação:** 43 testes gerais/fórmulas e 6 testes de área de transferência passaram; TypeScript e ESLint sem erros. Não houve migration, build nem escrita em produção.

### Revisão do Claude na 11ª rodada (2026-10-28)
- **Risco corrigido:** `PUT /api/contacts/[id]` faz quem é MEMBER (Consultor/Administrativo) virar responsável de cliente SEM responsável ao editar. "Enviar ao CRM" em massa tomaria a posse desses clientes. Agora a prévia consulta `/api/sheets/crm-data?ids=` e marca `writeCheck`: `claim` (sem responsável, role MEMBER) fica **fora do envio por padrão**, com caixa explícita avisando "você passa a ser o responsável"; `blocked` = não existe mais no CRM. O resto vai para a API, que decide (carteira, co-responsável, equipe) e cada recusa aparece no resultado.
- **Status do negócio virou só leitura** (Ganho/Perdido têm fluxo próprio: motivo de perda, comissão, processo); opções em português (Em andamento/Ganho/Perdido).
- Verificação: 37 testes gerais/fórmulas + 6 de área de transferência; tsc/eslint limpos; `test-sheets-prod.ts` 19/19 em produção.

## Revisão de inconsistências apontadas pelo Gemini (Claude, 2026-10-28)
- **2.1 Histórico:** rótulos "alterou a formatação"/"alterou a fórmula"; ROW_FORMULA mostra antes → depois já em A1 (via `formulaToText` do editor; linha fora da tela mostra aviso).
- **2.2 Arrastar/colar com filtro/ordem: falso positivo.** A coluna de números da grade mostra a posição real (`rank+1`), e o texto interno relativo dá o mesmo resultado do Excel ao copiar para outra linha.
- **2.3 Excluir/restaurar linhas reescreve fórmulas** (servidor, mesma transação, UPDATE em lote): referência abaixo sobe/desce, referência à linha excluída vira `#REF!`, intervalo encolhe (`remapFormulaRows`, `rowMapForRemoval`, `rowMapForInsertion` em `formula.ts`). A rota devolve `formulaChanges`; o Ctrl+Z restaura a linha e depois o texto original das fórmulas.
- **2.4 Trocar tipo para Seleção/Cliente/Negócio/Membro:** fórmulas da coluna contam como "não cabe" (409) e saem com `force`; conversões de valor viraram UPDATE em lote (`setCellsRaw`), sem N+1.
- **2.5 Casas decimais:** exportação usa `config.decimals` (moeda/%/número); limite 0–6 igual em servidor, diálogo e botões da faixa.
- **2.6 Recálculo no servidor** (`lib/sheets/recalc.ts`, mesmo `recalcSheet`): roda depois de escrita pela API v1 (POST/PATCH/DELETE) e de importação em planilha existente; grava só o que mudou; falha nunca derruba a escrita.
- **2.7 Ctrl+; / Ctrl+Shift+;:** data só em coluna de Data/Texto, hora só em Texto; nos outros tipos aparece aviso claro em vez do erro genérico.
- Verificação: 39 testes gerais/fórmulas + 6 de área de transferência; tsc/eslint limpos; `test-sheets-prod.ts` **22/22 em produção**.

## 12ª rodada — Seleção múltipla de colunas, linhas e células (2026-10-28)
Pedido: "selecionar varias colunas, linhas e celulas de uma vez".
- **Como o Excel faz:**
  - **Colunas:** clicar e arrastar pelas letras `A, B, C…`, `Shift+clique` para intervalo contínuo, `Ctrl+clique` / `Ctrl+arraste` para colunas não adjacentes, `Ctrl+Espaço` para expandir intervalos selecionados para colunas inteiras, ou digitar `A:C` na Caixa de Nome.
  - **Linhas:** clicar e arrastar pelos números `1, 2, 3…`, `Shift+clique` para intervalo contínuo, `Ctrl+clique` / `Ctrl+arraste` para linhas não adjacentes, `Shift+Espaço` para expandir intervalos selecionados para linhas inteiras, ou digitar `2:5` na Caixa de Nome.
  - **Células e múltiplos intervalos (`extraRanges` + `range`):** arraste livre com **rolagem automática na borda** da área visível; `Ctrl+clique` / `Ctrl+arraste` soma novos intervalos retangulares; `Ctrl+clique` sobre célula, linha ou coluna já selecionada **desmarca apenas o alvo** subdividindo o intervalo (`removeFromSelection` em `lib/sheets/format.ts`, igual ao Excel 365). Caixa de Nome (`parseNameBoxInput`) aceita `B12`, `A2:D10`, `A:C`, `2:5` e múltiplos intervalos separados por `;` ou `,` (`A2:B5; D2:D5`).
- **Ações em lote sobre toda a seleção (contínua ou não adjacente):**
  - Formatação (negrito, itálico, sublinhado, tachado, preenchimento, cor da fonte, alinhamento, todas as opções de bordas) e Limpar (Tudo / Formatos / Conteúdo / `Delete` / `Backspace`) percorrem todos os intervalos (`active.ranges`) sem duplicar células.
  - `Ctrl+Enter` aplica o valor/fórmula digitado em todas as células de todos os intervalos selecionados num único lote/Ctrl+Z; `Espaço` numa seleção múltipla alterna todas as caixas de seleção (`CHECKBOX`); `Ctrl+D` preenche para baixo em cada intervalo; colar 1×1 preenche todos os intervalos selecionados; copiar/recortar suporta múltiplas linhas ou colunas não adjacentes.
  - **Operações em múltiplas colunas selecionadas:** redimensionar uma coluna com várias colunas inteiras selecionadas aplica a nova largura a todas (`onResizeMany`); duplo clique na divisória ou "AutoAjuste da Largura" ajusta todas as colunas selecionadas; trocar tipo/formato ou casas decimais na Faixa de Opções e "Excluir Coluna(s)" (na Faixa ou menu de contexto) atuam sobre todas as colunas selecionadas (`selectedColumns`).
- **Fluidez e suavidade de movimento (estilo Excel 365):**
  - Moldura verde de seleção (`.xl-sel-box`, `.xl-extra-box`), destaque da célula em foco dentro de seleção múltipla (`.xl-focus-cell`), cabeçalhos de coluna/linha (`.xl-head-item`) e véu de seleção das células (`.xl-cell`) deslizam com curva `cubic-bezier(0.22, 1, 0.36, 1)` (~85–140ms) ao navegar por setas, Tab/Enter, clique, arraste ou AutoAjuste de largura (desativando a transição durante o arraste manual de largura `.xl-resizing` sincronizado por `requestAnimationFrame`).
  - Rolagem automática nas bordas em 60/120fps (`requestAnimationFrame` com curva de aceleração quadrática e acumulador sub-pixel) e rolagem suave (`behavior: "smooth"`) em saltos longos (PageUp/PageDown, Home/End, Ctrl+setas, Caixa de Nome), além de entrada suave (`.xl-menu-pop`) nos menus de contexto, AutoFiltro e menus da Faixa de Opções.
- **Capacidade ampliada para colar/importar planilhas grandes (antes limitado a 4 MB / 5 MB):**
  - `ROWS_BODY_LIMIT` (`SHEET_LIMITS.pasteBodyBytes`) em `/api/sheets/[id]/rows` e `/api/v1/sheets` subiu de **4 MB para 64 MB**, e `SHEET_LIMITS.batchRows` subiu de 1.000 para **5.000 linhas**.
  - Na tela (`sheet-editor.tsx`), `patchRows`, `insertRows` e `setDeleted` fatiamento automático em blocos de **1.000 linhas por requisição** na fila (mantendo tudo num único passo de `Ctrl+Z`), e `pasteGrid` expande colunas novas até o limite da planilha (`150 colunas`, preservando formatos e fórmulas) com fallback em memória (`memoryClip`) quando a cópia passa dos ~5 MB do `sessionStorage`.
  - Importação de arquivos `.xlsx/.csv` (`/api/sheets/import`, `lib/read-body.ts`, `lib/parse-spreadsheet.ts`) subiu de **5 MB para 25 MB** (descompactação segura até 96 MB no worker isolado).
- **Cálculos na barra de status (`Quantidade`, `Soma` e `Média` ao lado de `N linhas`)**:
  - Na barra inferior (`sheet-editor.tsx`), ao lado da contagem total de linhas da planilha (`{total} linhas`), aparecem sempre **Quantidade**, **Soma** e **Média** da seleção ativa (com formatação `R$` automática quando os valores selecionados são monetários).
  - `extractStatNumber` (`lib/sheets/format.ts`) reconhece números tanto em colunas numéricas (`NUMBER`, `CURRENCY`, `PERCENT`) quanto em colunas `TEXT`/`LONG_TEXT`/fórmulas onde dados foram colados do Excel (`"R$ 1.500,00"`, `"-R$ 250,00"`, `"1.234,56"`, `"250"`), ignorando `CPF`, `CNPJ`, `PHONE`, `DATE`, datas e telefones formatados.
  - Em `SheetGrid` (`sheet-grid.tsx`), selecionar colunas inteiras (`A`, `A:C`) não soma nem conta o cabeçalho da Linha 1 junto com os dados, e carrega automaticamente páginas seguintes (`onLoadMore`) mantendo a seleção estendida até o fim da planilha.
- **Abertura sempre em nova aba**:
  - Clicar em um cartão de planilha em `/planilhas` (`sheets-home.tsx`), criar/importar uma planilha nova, ou abrir/criar outra planilha dentro do editor (`sheet-editor.tsx` — abas inferiores, botão `+` e menu Arquivo → Abrir/Novo) abre `/planilhas/[id]` em uma nova aba do navegador (`target="_blank" rel="noopener noreferrer"` / `window.open`).
- **Desenhos das Bordas no estilo do Excel (`ribbon.tsx`)**:
  - O botão **Bordas** e cada opção do menu suspenso usam o ícone SVG 2×2 estilo Excel (`BorderGlyph`), onde as divisórias sem borda ficam pontilhadas em cinza-claro e as bordas ativas aparecem em traço sólido ou espesso (incluindo *Borda Inferior*, *Superior*, *Esquerda*, *Direita*, *Sem Borda*, *Todas as Bordas*, *Bordas Externas*, *Bordas Externas Espessas*, *Borda Inferior Espessa*, *Borda Superior e Inferior* e *Borda Superior e Inferior Espessa*).
- **Configuração de coluna intuitiva + atalhos rápidos de tipo (`column-dialog.tsx`, `autofilter-menu.tsx`, `sheet-editor.tsx`, `lib/sheets/sheets.ts`)**:
  - **Modal Configurar Coluna redesenhado (`column-dialog.tsx`)**: todos os 17 tipos visíveis de uma vez com exemplo de formatação (*R$ 1.250,00*, *29/10/2026*, *000.000.000-00*…), botão **✨ Sugerido pelos dados** que detecta automaticamente o tipo pelos valores preenchidos na coluna, botões rápidos de casas decimais com prévia ao vivo, e coleta automática de opções existentes ao mudar para *Lista de opções* / *Seleção múltipla*.
  - **Resolução amigável de conflitos ao trocar tipo (`lib/sheets/sheets.ts`, `lib/sheets/http.ts`)**: `parseLooseNumber` aceita `"R$ -"`, `"-"` (= `0` no formato Contábil do Excel) e `"(1.234,56)"` (negativo contábil); quando ainda restam células incompatíveis, a tela mostra exemplos reais com o número da linha (`Linha 14: "Isento"`) e permite **Converter incompatíveis para 0 e salvar**, **Adicionar às opções e salvar** ou **Limpar só esses N e salvar**.
  - **Mais formas rápidas de trocar o tipo da coluna**: botões de **Tipo rápido** (`Texto`, `Moeda R$`, `Número`, `Data`, `Lista`, `%`) direto no menu `▾` do cabeçalho da Linha 1 (`autofilter-menu.tsx`) e no clique direito da coluna (`ColumnMenuItems`), além do botão com o ícone/tipo da coluna ativa no canto direito da Barra de Fórmulas (`FormulaBar`).
  - **Grade limpa ao abrir planilha em branco**: removido o cartão flutuante `"Planilha em branco"` de dentro da grade (`sheet-grid.tsx`), deixando a planilha limpa igual ao Excel.
- Verificação: 42 testes gerais/fórmulas (`scripts/test-sheets.ts` + `scripts/test-sheets-formula.ts`) passando; `tsc --noEmit` e `eslint` sem erros.

## Desempenho — servidor (Claude, 2026-10-28)
Medido com `scripts/bench-sheets.ts [linhas]` (cria planilha [BENCH] em produção, cronometra, apaga). Daqui da máquina de dev cada ida e volta ao banco custa ~27 ms; em produção (app no mesmo servidor do banco) isso tende a ~0.
- **Causa nº 1 (achada no EXPLAIN):** o número da linha (`rank`) vinha de uma junção com uma CTE de janela; com a tabela recém-preenchida o Postgres estimava 1 linha e fazia laço aninhado (600 mil comparações, 230 ms). Agora o rank sai na MESMA varredura (janela em subconsulta antes do filtro, `PARTITION BY deletedAt IS NULL`), e o JSON das células só é lido para as linhas da página. Banco: página 131 → **14 ms** (3 mil linhas), 57 ms (20 mil).
- `queryRows` = 1 comando SQL (linhas + total por `COUNT(*) OVER` + total da planilha + "tem fórmula") em vez de 3; `loadSheetColumnsTx` = planilha + colunas numa consulta (antes Prisma com relação); vale para leituras e escritas.
- **Abrir** (`lib/sheets/open.ts` → `openSheet`): uma transação (estrutura + 1ª página + nomes de clientes/negócios) + abas leves em paralelo (`listSheetTabs`, sem contar linhas); `page.tsx` usa `cache()` para o título da aba não ler de novo. 307 → **153 ms** (3 mil), 227 ms (20 mil).
- **Planilha inteira para fórmulas:** `GET /api/sheets/[id]/rows/all` (`allRowsForCalc`, 1 comando, só id/valores/fórmulas/posição): 3 mil linhas 1.571 → **299 ms**; 20 mil 10,7 s → **1,4 s**. ⚠️ A tela ainda carrega pelo caminho antigo (páginas de 500) — trocar em `sheet-editor.tsx` (`loadCanon`).
- Pendente na TELA (aguardando o GPT terminar as edições simultâneas em `sheet-editor.tsx`/`sheet-grid.tsx`): `loading.tsx` com esqueleto da grade (clique abre na hora), `React.memo` nas células, rolagem por `requestAnimationFrame`, reaproveitar a 1ª página no cálculo, pré-carregar ao passar o mouse nas abas/cartões.
- Testes: `test-sheets-prod.ts` 22/22; fórmulas 15/15.

## Funções — revisão e catálogo completo (Claude, 2026-10-29)
- **REA não foi usado:** ele descompila o binário do Excel e a licença da Microsoft proíbe engenharia reversa do binário; o catálogo de funções é documentação pública (referência de funções + ECMA-376/OOXML), que é o caminho legal e mais preciso. Nada de nome/logo/identidade visual do Excel.
- **Bug corrigido:** HOJE()/AGORA() usavam o fuso de quem calculava (servidor em UTC × navegador local) → depois das 20h a tela e o recálculo do servidor discordavam e regravariam um ao outro. Agora ambos usam America/Campo_Grande (`FORMULA_TIMEZONE`, mesmo de `lib/timezone.ts`).
- **Bug corrigido:** número → texto (`=1/3&""`, CONCAT, PROCV por texto) cortava em 10 casas; agora 15 dígitos significativos, como o Excel.
- **+81 funções** (total 168 no catálogo): financeiras PGTO/VP/VF/NPER/TAXA (Newton)/IPGTO/PPGTO/VPL/TIR; estatísticas DESVPAD(.A/.P)/VAR(.A/.P)/MODO/ORDEM/PERCENTIL/QUARTIL/SOMAQUAD; matemáticas TETO(.MAT)/ARREDMULTB.MAT/MARRED/SINAL/EXP/LN/LOG/LOG10/FATORIAL/MDC/MMC/QUOCIENTE/PAR/ÍMPAR/SEN/COS/TAN/GRAUS/RADIANOS; lógicas/informação XOU/PARÂMETRO/VERDADEIRO()/FALSO()/ÉLÓGICO/ÉNÃOTEXTO/ÉERRO/É.NÃO.DISP/TIPO/N/T; texto EXATO/MUDAR/TEXTOANTES/TEXTODEPOIS/VALORNUMÉRICO/MOEDA/DEF.NÚM.DEC/UNICARACT/UNICODE; data/hora TEMPO/HORA/MINUTO/SEGUNDO/DATA.VALOR/VALOR.TEMPO/DIAS360/FRAÇÃOANO/NÚMSEMANAISO; referência LIN/COL/LINS/COLS/HIPERLINK. SUBTOTAL ganhou 7/8/10/11. Testes com valores de referência da documentação (ex.: PGTO(8%/12;10;10000) = -1.037,03; TIR do fluxo -70.000…26.000 = 8,66%).
- **Fica de fora de propósito:** ALEATÓRIO/ALEATÓRIOENTRE (volátil: o recálculo grava resultado → muda a planilha → recalcula de novo, em laço).
- **Ainda falta para "Excel completo"** (próximas rodadas): constantes de matriz `{1;2}` e matrizes dinâmicas (FILTRO, ÚNICO, CLASSIFICAR, SEQUÊNCIA), LET/LAMBDA, DESLOC/INDIRETO, referência a outra planilha (`Planilha2!A1`), nomes definidos; fora de fórmulas: mesclar, quebra de texto, congelar colunas, formatação condicional, validação de dados, comentários, gráficos, tabela dinâmica.
- Verificação: 52 testes gerais/fórmulas; tsc/eslint limpos; `test-sheets-prod.ts` 22/22.

## Tabela só na seleção + colunas sem título (Claude, 2026-10-29) — CONCLUÍDO
Pedido: "aplicar o design de tabela apenas no intervalo selecionado" e "remover 'Coluna 6', 'Coluna 7'… igual ao Excel, tudo em branco".
- **Feito (servidor):** coluna pode ter título vazio (`checkColumnName`; planilha continua exigindo nome). Importação: título vazio fica vazio e coluna 100% vazia (sem título e sem dado) não é criada. `tableSettingsSchema.range` = `{ c1, c2 (ids das pontas), r1, r2 (linha real do Excel; r2 null = até o fim) }`; `resolveTableRange` em `formats.ts`. Exportação: com `range`, a tabela do .xlsx cobre só o intervalo (cabeçalho = nomes das colunas se r1 = 1, senão a 1ª linha do intervalo; Linha de Totais só se r2 = null); nomes vazios/duplicados viram "Coluna1"… só dentro do arquivo (exigência do formato, igual ao Excel).
- **Falta (tela — bloqueado: o GPT estava editando `sheet-grid.tsx`/`sheet-editor.tsx`/`ribbon.tsx` às 08:33–08:38):** (1) `formatAsTable` gravar `range` a partir da seleção (seleção de 1 célula = região de dados, como no Excel); (2) a grade pintar cabeçalho/faixas/1ª coluna/totais só dentro de `resolveTableRange`; (3) digitar em coluna vazia criar a coluna com título vazio (hoje `createColumns` usa "ColunaN"); (4) rótulo "Coluna C" (letra) onde a coluna sem título precisa aparecer em menus/filtros/diálogos.

## Animações mais suaves nas Planilhas (Codex, 2026-10-29)
Pedido: deixar a experiência das planilhas um pouco mais “smooth”, sem prejudicar a resposta imediata de teclado, seleção e arraste.

- Tempos locais de movimento (`--xl-motion-fast`, `--xl-motion`, `--xl-motion-slow`) com a curva desacelerada `--ease-smooth`; continuam respeitando a regra global de `prefers-reduced-motion`.
- Seleção, foco, cabeçalhos e células agora interpolam posição, largura, altura, cores, bordas e sombra em 105–175 ms. Linhas virtualizadas ganharam `.xl-grid-row`: AutoAjuste de altura, filtro e reordenação reposicionam as linhas suavemente.
- Troca de guia da Faixa de Opções tem entrada curta e indicador animado; botões, ícones, menus, abas inferiores e controles do cabeçalho ganharam hover/press coerentes e discretos.
- Menus usam entrada própria com fade + pequeno deslocamento; status da seleção e avisos entram suavemente. O toast ganhou animação separada para não sobrescrever o `translateX(-50%)` usado na centralização.
- Arraste manual de largura continua sem transição (`.xl-resizing`) para acompanhar o ponteiro sem atraso; AutoAjuste mantém a animação. A barra de fórmulas não anima a cada troca de célula, evitando sensação de lentidão ao navegar por setas.
- Verificação: 52 testes gerais/fórmulas passando; `tsc --noEmit` e ESLint sem erros. Sem migration, build ou escrita em produção.

- **Concluído na tela (após o GPT parar):** `formatAsTable` grava `range` da seleção (várias células; seleção que chega ao fim dos dados = `r2: null`, a tabela cresce); uma célula só = planilha inteira; com tabela existente, trocar estilo mantém o intervalo. Grade pinta cabeçalho/faixas/1ª coluna só dentro de `resolveTableRange`; tabela que começa abaixo da linha 1 usa a 1ª linha do intervalo como cabeçalho (cor do estilo); Linha de Totais só quando a tabela vai até o fim dos dados. Digitar em coluna vazia cria coluna SEM título. `columnLabel` (format.ts) mostra "Coluna C" em avisos, filtros, AutoFiltro, colunas arquivadas, importar e integração com o CRM — só exibição.
- Verificação: 54 testes gerais/fórmulas; tsc/eslint limpos; `test-sheets-prod.ts` **23/23** (inclui coluna sem título e tabela exportada exatamente em B2:C3).
- Limitação conhecida: o intervalo da tabela usa a linha real do Excel; excluir linhas acima dele ainda não desloca o intervalo (as fórmulas já deslocam).

## TRUE/FALSE como caixa de seleção (Codex, 2026-10-29)
Pedido: valores lógicos vindos do Excel não devem aparecer como texto `TRUE`/`FALSE`; a coluna deve usar caixas marcadas/desmarcadas.

- A detecção booleana foi centralizada em `isCheckboxLikeColumn`, aceitando `TRUE/FALSE`, `VERDADEIRO/FALSO`, `SIM/NÃO`, `YES/NO`, `S/N`, `X` e `OK`, sem confundir colunas numéricas formadas por `0/1` com checkbox.
- A importação `.xlsx/.csv` usa essa detecção antes dos demais tipos e cria a coluna como `CHECKBOX`; os valores continuam passando por `coerceCellValue` e são armazenados como booleanos reais.
- O fluxo de colar do Excel para a direita da planilha também infere o tipo das novas colunas. Antes, todas as colunas expandidas pela colagem eram criadas obrigatoriamente como `TEXT`, que era a causa de `TRUE/FALSE` permanecer visível como texto.
- Verificação: 55 testes gerais/fórmulas passando; `tsc --noEmit` e ESLint sem erros. Sem migration, build ou escrita em produção.

## Histórico visual e restauração de versões (Codex, 2026-10-29)
Pedido: visualizar claramente o que mudou na planilha e conseguir voltar a um ponto anterior do histórico.

- O painel virou uma linha do tempo expansível. Alterações de célula mostram endereço, coluna e comparação visual **Antes → Depois**, com vermelho para o valor anterior e verde para o novo; fórmulas e formatações têm apresentação própria.
- Ao abrir um evento, a API monta um plano da versão correspondente ao estado imediatamente posterior àquela alteração, conta todos os eventos que seriam revertidos e agrupa o impacto (células, fórmulas, formatos, linhas e colunas).
- “Restaurar esta versão” exige confirmação, reaplica os eventos posteriores em ordem inversa, recalcula fórmulas, recarrega a planilha e registra `VERSION_RESTORED`; a restauração não apaga a trilha de auditoria.
- Segurança para legado: atividades antigas que não guardavam o estado anterior completo (por exemplo, formatação antiga ou limpeza integral de coluna) continuam visíveis, mas a restauração é bloqueada com o motivo em vez de produzir uma versão parcial.
- Novos eventos passaram a guardar antes/depois de formatação; alterações de nome/descrição/configuração da planilha e configuração/posição de colunas também ganharam dados suficientes para a linha do tempo.
- Limite inicial: restauração de até 500 eventos posteriores por operação, com rate limit próprio. Sem migration e sem escrita em produção durante o desenvolvimento.
- Verificação: 55 testes gerais/fórmulas passando; `tsc --noEmit` e ESLint sem erros.

## Modal de Colunas Arquivadas e melhorias de UX (2026-10-29)
- **Colunas arquivadas (`ArchivedColumnsDialog` em `sheet-editor.tsx`):** redesenhado com largura `max-w-lg`, `panelClassName="!p-0 !pb-0 overflow-hidden"` para eliminar barra de rolagem externa na borda do card, cabeçalho fixo com contador e botão de fechar, barra de busca instantânea (`Buscar coluna arquivada…`), seleção múltipla com `Selecionar todas`, lista rolável interna (`max-h-[340px] overflow-y-auto scrollbar-thin`) exibindo ícone + nome + rótulo do tipo (`SHEET_COLUMN_TYPE_LABELS`), e rodapé fixo com restauração em lote (**Restaurar N selecionadas** / **Restaurar todas**) integrada a `setColumnsArchived`.
- **Card "Planilha em branco":** removido de `sheet-grid.tsx` para deixar a grade limpa ao abrir planilhas novas.
- **Configuração intuitiva de coluna (`column-dialog.tsx`, `autofilter-menu.tsx`, `lib/sheets/sheets.ts`):** grade visual de tipos em 4 categorias, detecção automática por amostragem das células, coleta automática de opções para Seleção única/múltipla, sub-menu rápido **Tipo da coluna** no cabeçalho da coluna e resolução amigável de conflitos (`onInvalid: "zero" | "add_options" | "clear"`).

## Auditoria e ajustes de Tema Claro e Tema Escuro (2026-10-29)
- **Variáveis CSS em modais (`app/globals.css`):** variáveis `--xl*` expostas também em `:root` e `.dark` para que modais renderizados em portal (`document.body`, fora de `.xl-theme`) tenham acesso a `--xl`, `--xl-btn`, `--xl-soft`, etc. Adicionado `--xl-btn` (`#107c41` claro / `#15803d` escuro) para botões primários com texto branco, `--xl-border-auto` (`#000000` claro / `#8a8a8a` escuro) para bordas automáticas de célula e `color-scheme` para `<select>`/`<option>` nativos.
- **Grade, Estilos de Tabela e Preenchimento (`sheet-grid.tsx`, `lib/sheets/formats.ts`):** estilos de tabela `light-*` e `medium-*` não forçam mais texto preto `#000000` sobre linhas sem preenchimento no modo escuro (usam `var(--xl-cell-text)`). Corrigido espalhamento de `formatCss(fmt)` que anulava `band` e `tableText` quando a célula tinha apenas negrito/borda/alinhamento. Células com cor de preenchimento (`fmt.fill`) sem cor de fonte explícita calculam contraste automático por luminância (`#000000` em fundos claros como amarelo, `#FFFFFF` em escuros).
- **Diálogos, Faixa de Opções e Menus (`crm-integration-dialog.tsx`, `find-replace-dialog.tsx`, `paste-special-dialog.tsx`, `autofilter-menu.tsx`, `cell-editor.tsx`, `ribbon.tsx`, `sheet-editor.tsx`):** contraste e estados `dark:` ajustados em todos os botões primários/secundários, barra de fórmulas, caixa de busca da barra de título, abas inferiores, zoom, Backstage (`Arquivo`), seletores de célula e modal de colunas arquivadas.

## 2026-10-29 — Acesso restrito ao desenvolvedor (fase de testes em produção)
- `lib/sheets/access.ts`: `canUseSheets(m)` = regra antiga (Administrativo/Dono, ativo, fora da trava da Academia) **E** e-mail na lista beta.
  - Lista: env `SHEETS_BETA_USER_EMAILS` (vírgula). Sem a env → só `reoboteconsorciosti@gmail.com` (Reobote TI - Gabriel).
  - `SHEETS_ACCESS=all` → libera para a regra normal (fim do beta).
  - E-mail vem do banco (`getCurrentMembership().email`, campo novo), não do JWT.
- Menu (`app/(dashboard)/layout.tsx` `showSheets`), páginas e todas as rotas `/api/sheets/*` usam a mesma regra. A API v1 (chave de API) não muda.
- **Permissões por planilha (proprietário/editor/leitor/acesso geral): ADIADAS** a pedido do usuário. O rascunho fica no scratchpad da sessão (migration `20261029110000_sheets_permissions`: enums `SheetShareRole`/`SheetGeneralAccess`, `Sheet.ownerId`, `Sheet.generalAccess`, tabela `SheetPermission` com RLS; as planilhas que já existem viram `ORG_EDITOR` com o criador como dono). Nada disso está no schema nem no banco.
