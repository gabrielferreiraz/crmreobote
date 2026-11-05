# Redistribuição de negócios existentes — Painel Nichos

Esta operação localiza registros existentes. Não cria contatos nem negócios e não revalida/regrava os telefones originais.

## Ativação

No CRM, configure `PAINEL_NICHOS_REASSIGN_API_KEY_ID` com o **ID**, não o token, de uma chave dedicada do Painel. Ausente ou diferente da chave autenticada: resposta 403, nenhuma redistribuição.

No Painel, configure `CRM_EXISTING_DEALS_ENABLED=true` somente após implantar estes endpoints no CRM. A integração começa desmarcada na interface e exige consultor, funil e etapa. A importação da Black fica apenas no Painel. Reabrir negócios perdidos exige escolha explícita.

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

`dealId` é uma restrição opcional quando o ID original já é conhecido. Sem ele, a busca automática deve encontrar exatamente um negócio aberto/perdido do contato no funil selecionado. A etapa pertence a esse mesmo funil; esta versão não transfere negócios entre funis.

O solicitante é conferido novamente no CRM. Deve estar ativo como OWNER, MANAGER ou SUPERVISOR. O destino deve ser MEMBER ativo de Vendas. OWNER tem escopo global; MANAGER e SUPERVISOR respeitam as equipes gerenciadas/lideradas. Fora desse escopo, só permite assumir contato elegível pela regra existente em `evaluateLeadClaim`; demais casos retornam 403 para decisão no CRM.

A busca compara variantes nos quatro campos `phoneNormalized`, `whatsappNormalized`, `phone` e `whatsapp`. Considera formato, DDI 55, zero nacional, operadora e nono dígito de celular. Um fixo antigo como `0624250000` pode corresponder a `55624250000` já salvo; nenhuma dessas variantes é usada para substituir o cadastro. Número com `+` e DDI estrangeiro não recebe variantes brasileiras.

Retorna erro sem alterações se não houver contato, houver vários contatos, não houver negócio elegível ou houver vários negócios. Negócios ganhos não são alterados. Negócios perdidos exigem `reopenLost=true`. Também recusa quando outro negócio aberto/ganho do contato está atribuído a outro responsável ou faltam campos obrigatórios da etapa.

O resultado concluído tem `data.id` (negócio), `contactId`, `outcome: "updated"`, `auditId`, `before`, `after`, `warnings` e `replayed`. Contato, negócio, auditoria e atividade são gravados numa única transação SERIALIZABLE, com RLS configurada e bloqueio das linhas. Nenhum nome, telefone, descrição ou valor é reescrito.

A auditoria `PANEL_DISTRIBUTION_UPDATED` contém antes/depois e usa ID determinístico por organização/campanha/contato. Impede distribuir o mesmo contato duas vezes na campanha por formatos diferentes de telefone. O recibo `PANEL_DISTRIBUTION_RECEIPT` usa ID determinístico por organização/requestId. Repetir a solicitação devolve o resultado anterior, sem nova mutação; reutilizar requestId com dados diferentes retorna 409.

As notificações de mudança e atualização do Kanban acontecem após o commit. Falhar uma notificação não transforma uma transferência concluída em erro HTTP.

## Revisão e implantação

Os testes usam clientes de banco simulados: `node --test scripts/test-panel-redistribution.cjs`. Verifique também `npx prisma generate`, `npx next typegen` e `npx tsc --noEmit --incremental false` no checkout do CRM. Eles não substituem um ensaio em ambiente de homologação com PostgreSQL real e RLS.

Implante primeiro o CRM com a integração ainda desativada no Painel. Depois implante o Painel, confira a configuração e habilite o recurso. Nenhum teste de desenvolvimento deve enviar uma campanha real. A confirmação de envio pertence ao usuário na interface.

As filas antigas que criavam negócios da Black não devem ser reativadas automaticamente. O novo worker do Painel as marca para revisão. A resolução de ambiguidades continua sendo uma decisão no CRM; não existe nesta versão uma escolha arbitrária ou fallback de criação.
