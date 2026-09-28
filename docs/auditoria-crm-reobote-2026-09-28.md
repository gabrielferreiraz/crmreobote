# Auditoria de Segurança, Confiabilidade e Qualidade

**Projeto:** CRM Reobote  
**Data da auditoria:** 28/09/2026  
**Ambiente:** produção em VPS com EasyPanel  
**Tipo:** análise estática e revisão de fluxos, sem alteração do sistema

## Status geral

O sistema **não deve receber uma nova publicação** antes da correção dos itens P0. Os principais bloqueadores são:

- possibilidade de tomada de conta entre organizações;
- credenciais e dados pessoais expostos em logs;
- dependências de produção com vulnerabilidades conhecidas;
- falhas de autorização em tarefas, contatos, scripts e campanhas.

Este documento funciona como registro da situação encontrada e checklist para validar as correções futuras.

## Escala de prioridade

- **P0 - Bloqueador:** corrigir antes de qualquer deploy.
- **P1 - Alto:** corrigir antes de ampliar o uso ou liberar novas integrações.
- **P2 - Importante:** corrigir no próximo ciclo técnico.
- **P3 - Melhoria:** corrigir progressivamente, acompanhando métricas.

## P0 - Bloqueadores de segurança

### P0-01 - Tomada de conta entre organizações

**Status:** [ ] Não corrigido  
**Severidade:** crítica  
**Risco:** um atacante pode criar uma organização, adicionar o e-mail de um usuário existente e redefinir a senha global dele. Como o login seleciona a associação ativa mais antiga, isso pode abrir a organização original da vítima.

**Evidências:**

- [Registro público](/C:/Users/Gabriel/Downloads/crm-reobote/app/api/register/route.ts:15)
- [Inclusão de usuário existente](/C:/Users/Gabriel/Downloads/crm-reobote/app/api/org/members/route.ts:52)
- [Redefinição global de senha](/C:/Users/Gabriel/Downloads/crm-reobote/app/api/org/members/[userId]/reset-password/route.ts:20)
- [Seleção da organização no login](/C:/Users/Gabriel/Downloads/crm-reobote/lib/auth.ts:167)

**Correção recomendada:**

1. Impedir que uma organização vincule automaticamente uma conta existente.
2. Usar convite com aceite e confirmação do próprio usuário.
3. Nunca permitir que OWNER de uma organização altere senha ou e-mail global de outra conta.
4. Implementar revogação de sessões após alterações de credenciais.
5. Separar dados globais de usuário dos dados específicos da organização.
6. Criar teste de regressão tentando acessar uma organização A a partir da organização B.

### P0-02 - Segredos e dados pessoais em logs

**Status:** [ ] Não corrigido  
**Severidade:** crítica  
**Risco:** tokens Meta, códigos OAuth, QR/pairing da Evolution, URLs com segredos, telefones e identificadores podem permanecer nos logs da VPS ou de serviços externos.

**Evidências:**

- [Meta Graph](/C:/Users/Gabriel/Downloads/crm-reobote/lib/meta-graph.ts:77)
- [Meta Ads](/C:/Users/Gabriel/Downloads/crm-reobote/lib/meta-ads.ts:57)
- [Evolution API](/C:/Users/Gabriel/Downloads/crm-reobote/lib/evolution.ts:109)
- [Configuração do webhook](/C:/Users/Gabriel/Downloads/crm-reobote/app/api/whatsapp/instance/route.ts:72)
- [Eventos do WhatsApp](/C:/Users/Gabriel/Downloads/crm-reobote/lib/whatsapp/events.ts:165)

**Correção recomendada:**

1. Remover tokens, QR codes, payloads completos, telefones e URLs sensíveis dos logs.
2. Aplicar redaction centralizado para chaves como `access_token`, `apikey`, `base64`, `password`, `secret` e `remoteJid`.
3. Rotacionar todos os segredos que possam ter sido registrados.
4. Definir retenção e acesso restrito aos logs da VPS.
5. Criar alerta para impedir que novos tokens sejam gravados.

### P0-03 - Dependências vulneráveis

**Status:** [ ] Não corrigido  
**Resultado:** `npm audit --omit=dev`: 21 vulnerabilidades, sendo 4 críticas, 10 altas e 7 moderadas.

**Pacotes principais encontrados:**

| Pacote | Versão instalada | Ação |
|---|---:|---|
| `next` | `16.2.10` | Atualizar para versão corrigida compatível |
| `next-auth` | `5.0.0-beta.31` | Atualizar para `beta.32` ou superior |
| `@auth/prisma-adapter` | `2.11.2` | Atualizar para versão corrigida |
| `sharp` | `0.34.5` | Atualizar, pois processa uploads não confiáveis |
| `nodemailer` | `7.0.13` | Atualizar conforme compatibilidade |
| `prisma` | `7.8.0` | Avaliar atualização com migração e testes |

**Fontes oficiais:**

- [Advisories do Next.js](https://github.com/vercel/next.js/security/advisories)
- [Atualizações oficiais do Next.js](https://nextjs.org/blog)
- [Advisories do Auth.js](https://github.com/nextauthjs/next-auth/security/advisories)

**Validação obrigatória após atualizar:** `npm audit --omit=dev`, `npx tsc --noEmit`, testes de login, upload, imagens, propostas, WhatsApp e geração de PDF.

## P1 - Riscos altos

### P1-01 - Autorização insuficiente em tarefas e contatos

Usuários podem associar tarefas a negócios ou contatos fora do próprio escopo, atribuí-las a membros arbitrários e alterar tags ou qualificação de contatos sem uma validação de escopo suficientemente restrita.

**Evidências:**

- [Criação de tarefas](/C:/Users/Gabriel/Downloads/crm-reobote/app/api/tasks/route.ts:85)
- [Edição de tarefas](/C:/Users/Gabriel/Downloads/crm-reobote/app/api/tasks/[id]/route.ts:72)
- [Tags do contato](/C:/Users/Gabriel/Downloads/crm-reobote/app/api/contacts/[id]/tags/route.ts:22)
- [Qualificação do contato](/C:/Users/Gabriel/Downloads/crm-reobote/app/api/contacts/[id]/lead-qualification/route.ts:15)

**Correção:** validar organização, escopo do usuário, equipe, negócio, contato e responsável em cada operação de leitura e escrita.

### P1-02 - Scripts privados expostos ou editáveis

Scripts `PRIVATE` podem ser utilizados por consumidores que verificam apenas o ID e a organização. A regra de edição também permite que scripts públicos sejam editados ou excluídos por qualquer usuário.

**Evidência:** [Biblioteca de scripts](/C:/Users/Gabriel/Downloads/crm-reobote/lib/campaigns/scripts.ts:18)

**Correção:** centralizar uma única política para visualizar, usar, editar, excluir e aplicar script em campanha. Validar essa política em todos os consumidores.

### P1-03 - Impersonação em campanhas e automações

Consultores podem selecionar instâncias WhatsApp de outros membros da organização. A validação atual verifica organização e conexão, mas não exige autorização para enviar usando aquele número.

**Correção:** limitar instâncias por responsável, permitir delegação explícita e exigir OWNER/MANAGER para campanhas em nome de terceiros.

### P1-04 - Uploads e webhooks sem limite efetivo de corpo

Rotas usam `formData()`, `json()` e `arrayBuffer()` integralmente, em alguns casos antes da autenticação. Corpos grandes ou chunked podem causar consumo excessivo de memória na VPS.

**Evidência:** [Upload de anúncios da TV](/C:/Users/Gabriel/Downloads/crm-reobote/app/api/tv/ads/route.ts:16)

**Correção:** limitar o corpo no proxy/EasyPanel, rejeitar `Content-Length` acima do limite, autenticar antes de processar quando possível e usar processamento com limite de bytes.

### P1-05 - Exclusão cruzada de anúncios da TV

A exclusão valida apenas se a URL pertence ao bucket público. Não valida se a chave começa com `tv-ads/{organizationId}/`.

**Evidência:** [Exclusão no R2](/C:/Users/Gabriel/Downloads/crm-reobote/lib/r2.ts:337)

**Correção:** extrair e validar o `organizationId` da chave contra a sessão antes de excluir.

### P1-06 - SSRF e mídia externa no WhatsApp

O envio manual aceita `mediaUrl` arbitrária e pode fazer a Evolution ou Meta buscar uma URL controlada pelo usuário. Também há risco de acesso indevido a objetos internos caso uma chave R2 seja exposta.

**Correção:** aceitar somente URLs geradas pelo próprio CRM, validar o namespace da organização, bloquear hosts privados e remover URLs externas do fluxo de produção.

### P1-07 - Fluxos de envio sem idempotência

Campanhas, ondas, lembretes e scripts podem enviar uma mensagem e falhar antes de registrar o resultado, ou registrar antes de enviar. Reinícios podem causar duplicidade ou perda de mensagens.

**Correção:** usar fila durável, chave de idempotência por destinatário/etapa, estados explícitos e confirmação do provedor antes de avançar.

## P2 - Tarefas, Agenda e Relatórios

### Cobertura confirmada

- Existem oito tipos de tarefa: ligação, WhatsApp, e-mail, videochamada, visita, proposta, nota e outro. [Schema](/C:/Users/Gabriel/Downloads/crm-reobote/prisma/schema.prisma:2085)
- A Agenda não exclui tipos e exibe tarefas dentro do escopo permitido. [Agenda](/C:/Users/Gabriel/Downloads/crm-reobote/app/(dashboard)/agenda/page.tsx:40)
- Relatórios contam tarefas concluídas agrupadas por responsável e tipo. [Relatórios](/C:/Users/Gabriel/Downloads/crm-reobote/lib/reports/commercial-data.ts:376)

### Problemas encontrados

- A Agenda possui teto de 5.000 tarefas e só mostra concluídas dos últimos 30 dias.
- O início mostra somente cinco tarefas futuras do usuário atual, ignorando atrasadas e tarefas sem prazo. [Início](/C:/Users/Gabriel/Downloads/crm-reobote/app/(dashboard)/page.tsx:147)
- O ranking de videochamadas e visitas usa `Activity.createdAt`, em vez da data de conclusão ou realização. [Relatórios](/C:/Users/Gabriel/Downloads/crm-reobote/lib/reports/commercial-data.ts:353)
- Excluir uma tarefa de videochamada ou visita deixa a Activity vinculada em estado pendente. [Exclusão](/C:/Users/Gabriel/Downloads/crm-reobote/app/api/tasks/[id]/route.ts:258)
- Remarcar uma reunião executa várias escritas sem uma transação única. [Remarcação](/C:/Users/Gabriel/Downloads/crm-reobote/app/api/tasks/[id]/route.ts:109)
- Algumas telas atualizam a interface mesmo quando a API retorna erro.
- O card do negócio lista tarefas sem paginação e sem destaque suficiente do tipo.

**Critério de aceite:** criar uma tarefa de cada tipo, visualizar na Agenda, no negócio, no início e nos Relatórios; concluir, remarcar, excluir e verificar que os contadores e Activities permanecem consistentes.

## P2 - Desempenho e infraestrutura

- Cada operação com RLS adiciona transação e configuração de contexto. [Prisma](/C:/Users/Gabriel/Downloads/crm-reobote/lib/prisma.ts:83)
- O processo pode abrir até 40 conexões entre aplicação, busca e locks de cron.
- Relatórios carregam grandes históricos em memória.
- Conversas consultam até 200 mensagens repetidamente.
- Backups podem carregar até 500 MB em memória antes do upload.
- Crons retornam HTTP 200 mesmo em falhas, dificultando o monitoramento externo.
- O health check não verifica banco, R2, filas ou crons.
- Migrações executam automaticamente ao iniciar o container.
- O modelo aceita múltiplas organizações, mas senha, avatar, cartão digital e empresa possuem campos globais.

## P3 - Qualidade e experiência

- TypeScript passou sem erros.
- `prisma validate` passou.
- Testes puros executados: 66 de 66 passaram.
- ESLint falhou com 74 erros e 53 avisos no produto.
- Não existe suíte formal de testes configurada no `package.json`.
- Modais não possuem foco preso, restauração de foco, `aria-modal` e identificação semântica consistente.
- Existem botões de ícone sem rótulo acessível.
- Vários handlers ignoram respostas HTTP não bem-sucedidas.

## Checklist de validação pós-correção

### Segurança

- [ ] Não é possível vincular automaticamente um usuário existente por e-mail.
- [ ] Um OWNER não consegue alterar senha ou e-mail global de outro usuário.
- [ ] Sessões são revogadas após alteração de credencial.
- [ ] Logs não contêm tokens, QR codes, senhas, telefones completos ou payloads sensíveis.
- [ ] Todos os segredos potencialmente expostos foram rotacionados.
- [ ] `npm audit --omit=dev` não apresenta vulnerabilidades críticas ou altas aceitas sem justificativa.
- [ ] Tarefas, contatos, negócios, scripts e instâncias respeitam o escopo do usuário.
- [ ] Uploads e webhooks têm limite de corpo aplicado também no proxy.
- [ ] Mídia externa arbitrária foi bloqueada.
- [ ] Exclusão de objetos R2 valida o namespace da organização.

### Tarefas, Agenda e Relatórios

- [ ] Os oito tipos aparecem na Agenda.
- [ ] Os oito tipos aparecem no card do negócio.
- [ ] Os oito tipos aparecem corretamente nos Relatórios.
- [ ] Tarefas atrasadas e sem prazo possuem tratamento definido no Início.
- [ ] Data de agendamento, conclusão e realização possuem semântica documentada.
- [ ] Excluir tarefa remove ou atualiza corretamente a Activity vinculada.
- [ ] Remarcação é atômica.
- [ ] A interface mostra erro quando uma operação falha.

### Operação

- [ ] Health check verifica banco, R2 e dependências essenciais.
- [ ] Falha de cron chega ao monitor externo com status não-2xx ou alerta independente.
- [ ] Backup é transmitido sem carregar todo o arquivo em memória.
- [ ] Existe teste periódico de restauração do backup.
- [ ] Deploy com migração possui estratégia controlada e rollback documentado.
- [ ] Pools de conexão foram dimensionados para o limite real do PostgreSQL.

## Evidências executadas

```text
npx prisma validate                         PASSOU
npx tsc --noEmit --incremental false       PASSOU
npx tsx --test scripts/test-campaign-instance-guard.ts scripts/test-campaign-queue.ts
                                            39/39 PASSOU
node --test lib/phone-normalize.test.mjs    27/27 PASSOU
npm audit --omit=dev                        21 vulnerabilidades
ESLint do produto                           74 erros / 53 avisos
```

Não foram executados `next build`, testes E2E no navegador ou testes que escrevam no banco de produção, para não interferir no ambiente em uso.

## Atualização de implementação - 28/09/2026

Esta rodada corrigiu pontos identificados na revisão posterior da Seção 3:

- Mutações de automações, equipes, grupos compartilhados, webhooks, pipelines e categorias agora atualizam a tela somente quando a API confirma sucesso.
- O renomeio otimista de categoria reverte o nome local quando a requisição falha.
- O Kanban de Processos trata quedas de rede ao recarregar e ao buscar mais itens, sem deixar uma Promise rejeitada.
- As rotas de Processos, categorias, subcategorias e Propostas leem JSON somente depois da autorização e com limite de 1 MB.
- A entrega de webhook limita a resposta do destino externo a 1 MB, evitando consumo de memória ilimitado na VPS.
- Foram removidos quatro efeitos de estado redundantes da árvore de Processos.

Evidências desta rodada:

```text
npx eslint (25 arquivos alterados)          PASSOU
npx tsc --noEmit --incremental false         PASSOU
npx prisma validate                          PASSOU
git diff --check                             PASSOU
```

Não foi executado build completo, testes E2E ou qualquer operação contra o banco de produção.

## Regra de encerramento da auditoria

Esta auditoria só deve ser marcada como concluída quando:

1. Todos os itens P0 estiverem corrigidos e testados.
2. Cada item P1 tiver responsável, evidência e data de validação.
3. A checklist acima estiver preenchida com evidências reais.
4. Houver teste de regressão para autorização entre organizações.
5. O deploy for validado em ambiente de homologação antes da VPS de produção.
