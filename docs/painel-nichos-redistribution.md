# Redistribuição de negócios existentes — Painel Nichos

Esta operação localiza registros existentes e não revalida/regrava os telefones originais. Só cria algo em dois casos: negócio novo para um contato livre pelas regras abaixo, e contato novo no último recurso.

## Ativação

Não há variáveis novas. Os endpoints aceitam uma chave de API válida da organização, e o solicitante (`actorId`) é conferido a cada chamada. Na interface, o clique em **Importar no CRM** autoriza o envio, com `reopenLost=true` e `createIfMissing=true`. A importação da Black fica apenas no Painel.

## Quem pode receber o lead

Uma única função (`classifyPanelLead`) decide, e é a mesma na checagem em lote e na gravação. Para cada telefone, olha todos os contatos que o têm e todos os negócios deles, em qualquer funil.

| Situação do lead no CRM | Resultado |
|---|---|
| Não existe | Livre: entra como contato novo (último recurso, abaixo) |
| Negócio **aberto** de consultor ativo | **Bloqueado** (`BLOCKED_OPEN_ACTIVE`) |
| Negócio **ganho** (cliente) de consultor ativo | **Bloqueado** (`BLOCKED_CLIENT_ACTIVE`) |
| Contato de consultor ativo, sem nenhum negócio (ou só com aberto/ganho de inativo) | **Bloqueado** (`BLOCKED_OWNER_ACTIVE`) |
| Perdido há menos de 3 meses por consultor ativo, ou o consultor mexeu no lead nesse prazo | **Bloqueado** (`BLOCKED_LOST_RECENT`); o prazo recomeça a cada movimento do consultor |
| Aberto de consultor **inativo** | Livre: o negócio é transferido, mantendo tudo |
| Ganho de consultor **inativo** | Livre: negócio novo; o ganho continua como está |
| Perdido por consultor inativo, em qualquer data | Livre: negócio novo |
| Perdido há mais de 3 meses por consultor ativo | Livre: negócio novo |

Em todo caso livre, o responsável do contato e o do negócio passam a ser o consultor escolhido. **Negócio perdido nunca é reaberto**: o antigo mantém motivo, data e responsável, e o consultor recebe um negócio novo na etapa da campanha. Se vários contatos têm o telefone, um único bloqueio bloqueia o lead; para escolher o cadastro, vale o que tem o nome da planilha e, depois, o do negócio mais recente. O consultor de destino precisa ser da equipe de quem pede; os leads, não. Qualquer equipe pode receber um lead livre, e nem o OWNER passa por cima de um consultor ativo.

A recusa devolve `details: [{ code, retryAfter }]`. `retryAfter` é a data a partir da qual vale perguntar de novo (fim dos 3 meses, ou 30/90 dias); `null` significa que não volta. Nenhum nome, descrição, valor ou telefone preenchido é reescrito. Contato com número só nos campos normalizados tem `phone`/`whatsapp` vazios preenchidos com o número que o cadastro já tem (`PANEL_DISTRIBUTION_PHONE_RESTORED`), porque a tela e o WhatsApp leem apenas esses campos.

Continuam recusados, sem alterar nada: telefone inválido, contato já distribuído na campanha e as travas do último recurso.

## POST /api/v1/painel-nichos/eligibility

Somente leitura. O Painel pergunta, antes de reservar leads, quais telefones podem ir para um consultor. Corpo: `{ campaignKey, pipelineId, phones: [até 200] }`. Resposta: `data.results[]` com `index`, `phone`, `free` e, se livre, `action` (`NEW`, `TRANSFER` ou `NEW_DEAL`); se bloqueado, `code`, `reason` e `retryAfter`. Limite de 60/minuto por chave. A gravação confere as mesmas regras de novo, porque o estado pode mudar entre a pergunta e o envio.

## POST /api/v1/painel-nichos/contacts

Lista de nicho do Painel: grava contatos novos para um consultor, com o mesmo tratamento de `/api/v1/contacts/bulk` (`upsertContactFromIntegration`). Até 50 contatos por chamada, limite de 120/minuto por chave (o lote genérico aceita 10/minuto). A resposta traz `data.results[]` por contato (`created`, `updated` ou `error`) e `data.summary`. Um contato com erro não derruba os outros do lote. O Painel envia em lotes de 25 e, se este endpoint não existir (CRM antigo), usa o lote genérico.

## Último recurso: criar quando não encontrar

A base da campanha foi extraída do próprio CRM, então não encontrar um cadastro é exceção. Só cria com `createIfMissing=true` e sem `dealId` na solicitação, e apenas nestas condições:

- **Contato não encontrado:** exige `fallback.name` e telefone válido para cadastro (nunca cria contato sem número). Antes de criar, uma busca ampla procura o mesmo final de telefone (8 dígitos), nome ou e-mail. Qualquer resultado bloqueia a criação (`CONTACT_POSSIBLE_MATCH`).
- **Disjuntor:** no máximo 300 contatos novos por organização em 24 horas (`CREATION_LIMIT_REACHED`). Negócio novo para contato que já existe (regras acima) não conta nesse limite.
- **Etapa:** campos obrigatórios não preenchidos geram um aviso em `warnings`, sem bloquear a criação.

Tudo ocorre na mesma transação, com `outcome: "created"`, `before: null` e auditoria `PANEL_DISTRIBUTION_CREATED`.

Os endpoints usam as tabelas existentes do CRM; esta alteração não requer migração de schema. Não é necessário alterar o endpoint de notas nem o upsert de integrações comuns.

## GET /api/v1/painel-nichos/stages

Autenticação com Bearer da chave dedicada. Retorna `{ success: true, data: { pipelines: [{ id, name, stages: [{ id, name }] }] } }`. Limite de 60/minuto por chave.

## POST /api/v1/painel-nichos/redistributions

Limite de 30/minuto por chave. Solicitação:

```json
{
  "requestId": "black-friday:1:lead:123",
  "campaignKey": "black-friday-2026",
  "phone": "0624250000",
  "actorId": "id-do-solicitante-autenticado-no-painel",
  "ownerId": "id-do-consultor-escolhido",
  "pipelineId": "id-do-funil-original",
  "stageId": "id-da-etapa-de-destino",
  "reopenLost": false
}
```

`dealId` é uma restrição opcional quando o ID original já é conhecido. Sem ele, a busca automática aplica as decisões descritas acima. A etapa pertence a esse mesmo funil; esta versão não transfere negócios entre funis.

O solicitante é conferido novamente no CRM. Deve estar ativo como OWNER, MANAGER ou SUPERVISOR. O destino deve ser MEMBER ativo de Vendas. OWNER tem escopo global; MANAGER e SUPERVISOR só enviam para as equipes que gerenciam ou lideram (403 fora delas).

A busca compara variantes nos quatro campos `phoneNormalized`, `whatsappNormalized`, `phone` e `whatsapp`. Considera formato, DDI 55, zero nacional, operadora e nono dígito de celular. Um fixo antigo como `0624250000` pode corresponder a `55624250000` já salvo; nenhuma dessas variantes é usada para substituir o cadastro. Número com `+` e DDI estrangeiro não recebe variantes brasileiras.

Retorna erro sem alterações se não houver contato (sem poder criar) ou se o lead estiver bloqueado. `reopenLost` é aceito por compatibilidade e ignorado: negócio perdido nunca é reaberto.

O resultado concluído tem `data.id` (negócio), `contactId`, `outcome: "updated"`, `auditId`, `before`, `after`, `warnings` e `replayed`. Contato, negócio, auditoria e atividade são gravados numa única transação SERIALIZABLE, com RLS configurada e bloqueio das linhas. Nenhum nome, descrição, valor ou telefone preenchido é reescrito.

A auditoria `PANEL_DISTRIBUTION_UPDATED` contém antes/depois e usa ID determinístico por organização/campanha/contato. Impede distribuir o mesmo contato duas vezes na campanha por formatos diferentes de telefone. O recibo `PANEL_DISTRIBUTION_RECEIPT` usa ID determinístico por organização/requestId. Repetir a solicitação devolve o resultado anterior, sem nova mutação; reutilizar requestId com dados diferentes retorna 409.

As notificações de mudança e atualização do Kanban acontecem após o commit. Falhar uma notificação não transforma uma transferência concluída em erro HTTP.

## Revisão e implantação

Os testes usam clientes de banco simulados: `node --test scripts/test-panel-redistribution.cjs`. Verifique também `npx prisma generate`, `npx next typegen` e `npx tsc --noEmit --incremental false` no checkout do CRM. Eles não substituem um ensaio em ambiente de homologação com PostgreSQL real e RLS.

Implante primeiro o CRM com a integração ainda desativada no Painel. Depois implante o Painel, confira a configuração e habilite o recurso. Nenhum teste de desenvolvimento deve enviar uma campanha real. A confirmação de envio pertence ao usuário na interface.

As filas antigas que criavam negócios da Black não devem ser reativadas automaticamente. O novo worker do Painel as marca para revisão.
