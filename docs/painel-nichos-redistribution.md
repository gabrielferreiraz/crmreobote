# Redistribuição de negócios existentes — Painel Nichos

Esta operação localiza registros existentes e não revalida/regrava os telefones originais. Só cria algo no último recurso descrito abaixo.

## Ativação

Não há variáveis novas. Os endpoints aceitam uma chave de API válida da organização, e o solicitante (`actorId`) é conferido a cada chamada. Na interface, o clique em **Importar no CRM** autoriza o envio, com `reopenLost=true` e `createIfMissing=true`. A importação da Black fica apenas no Painel.

## Decisões automáticas

- **Vários contatos com o telefone:** vale o que tem o nome da planilha; depois, o que tem negócio aberto; depois, o negócio alterado mais recentemente. Se qualquer um deles já foi distribuído na campanha, o lead é recusado com `CONTACT_ALREADY_DISTRIBUTED`.
- **Vários negócios no funil:** vale o aberto; depois, o alterado mais recentemente. Os demais não são alterados.
- **Outro negócio aberto ou ganho com outro responsável:** o negócio escolhido é transferido, o contato continua com o responsável atual e a resposta traz um aviso em `warnings`.
- **Campos obrigatórios na etapa:** o negócio entra na etapa da campanha mesmo assim, e a resposta traz um aviso em `warnings`. Nenhum valor é inventado; o consultor preenche o que faltar.
- **Negócio perdido de outra equipe:** é transferido, inclusive por SUPERVISOR ou MANAGER, porque ninguém o está trabalhando.

Continuam recusados, sem alterar nada: contato sem negócio aberto ou perdido no funil, telefone inválido, travas do último recurso e negócio aberto de responsável ativo de outra equipe.

## Último recurso: criar quando não encontrar

A base da campanha foi extraída do próprio CRM, então não encontrar um cadastro é exceção. Só cria com `createIfMissing=true` e sem `dealId` na solicitação, e apenas nestas condições:

- **Contato não encontrado:** exige `fallback.name` e telefone válido para cadastro (nunca cria contato sem número). Antes de criar, uma busca ampla procura o mesmo final de telefone (8 dígitos), nome ou e-mail. Qualquer resultado bloqueia a criação (`CONTACT_POSSIBLE_MATCH`).
- **Contato encontrado:** só cria o negócio se o contato não tiver nenhum negócio, em nenhum funil e com nenhum status. Vários contatos com o telefone, ou contato com qualquer negócio, nunca geram criação.
- **Disjuntor:** no máximo 20 criações por organização em 24 horas (`CREATION_LIMIT_REACHED`).
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

O solicitante é conferido novamente no CRM. Deve estar ativo como OWNER, MANAGER ou SUPERVISOR. O destino deve ser MEMBER ativo de Vendas. OWNER tem escopo global; MANAGER e SUPERVISOR respeitam as equipes gerenciadas/lideradas. Fora desse escopo, um negócio perdido pode ser transferido; um negócio aberto só se o contato for elegível pela regra existente em `evaluateLeadClaim`, e os demais casos retornam 403.

A busca compara variantes nos quatro campos `phoneNormalized`, `whatsappNormalized`, `phone` e `whatsapp`. Considera formato, DDI 55, zero nacional, operadora e nono dígito de celular. Um fixo antigo como `0624250000` pode corresponder a `55624250000` já salvo; nenhuma dessas variantes é usada para substituir o cadastro. Número com `+` e DDI estrangeiro não recebe variantes brasileiras.

Retorna erro sem alterações se não houver contato (sem poder criar) ou negócio elegível. Negócios ganhos não são alterados. Negócios perdidos exigem `reopenLost=true`.

O resultado concluído tem `data.id` (negócio), `contactId`, `outcome: "updated"`, `auditId`, `before`, `after`, `warnings` e `replayed`. Contato, negócio, auditoria e atividade são gravados numa única transação SERIALIZABLE, com RLS configurada e bloqueio das linhas. Nenhum nome, telefone, descrição ou valor é reescrito.

A auditoria `PANEL_DISTRIBUTION_UPDATED` contém antes/depois e usa ID determinístico por organização/campanha/contato. Impede distribuir o mesmo contato duas vezes na campanha por formatos diferentes de telefone. O recibo `PANEL_DISTRIBUTION_RECEIPT` usa ID determinístico por organização/requestId. Repetir a solicitação devolve o resultado anterior, sem nova mutação; reutilizar requestId com dados diferentes retorna 409.

As notificações de mudança e atualização do Kanban acontecem após o commit. Falhar uma notificação não transforma uma transferência concluída em erro HTTP.

## Revisão e implantação

Os testes usam clientes de banco simulados: `node --test scripts/test-panel-redistribution.cjs`. Verifique também `npx prisma generate`, `npx next typegen` e `npx tsc --noEmit --incremental false` no checkout do CRM. Eles não substituem um ensaio em ambiente de homologação com PostgreSQL real e RLS.

Implante primeiro o CRM com a integração ainda desativada no Painel. Depois implante o Painel, confira a configuração e habilite o recurso. Nenhum teste de desenvolvimento deve enviar uma campanha real. A confirmação de envio pertence ao usuário na interface.

As filas antigas que criavam negócios da Black não devem ser reativadas automaticamente. O novo worker do Painel as marca para revisão.
